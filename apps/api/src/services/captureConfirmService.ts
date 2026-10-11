import {
  CAPTURE_CONFIRM_MESSAGES,
  dueFromLocal,
  fieldErrorsOf,
  normalizeNameKey,
  pickSubjectColor,
  createActivitySchema,
  type CaptureConfirmInput,
  type CaptureConfirmItemError,
  type CaptureConfirmResponse,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { toSubjectDto } from '../mappers.js';
import { createActivityRepository } from '../repositories/activityRepository.js';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { createActivityService, type Actor } from './activityService.js';

/** Ten activities and their reminders are a few dozen queries: well within this, even on a remote database. */
const TRANSACTION = { maxWait: 5_000, timeout: 30_000 };

/**
 * Confirmation of the proposals of one capture: the NEW subjects and every activity, in ONE database transaction. Either
 * all of it is saved or none of it is.
 *
 * The rules are not rewritten here: each activity goes through the very same Activity service as `POST /api/activities`
 * (ownership of the subject, the period derived from it or from the current one, the instant, the automatic reminders),
 * bound to the transaction's connection. What this service adds is only what a batch needs: resolving which subjects
 * exist, creating the missing ones (name key, color and period come from the server), refusing an exact copy of an
 * existing activity and reporting every refused item at once, by the `clientId` the card was shown under.
 *
 * Concurrency: confirmations of the same user take a transaction-level advisory lock, so two at the same time (a double
 * tap, a retry) run one after the other and the second sees the first's activities. It is refused as a copy instead of
 * creating everything twice. Subjects are inserted with ON CONFLICT DO NOTHING, which also protects against a plain
 * `POST /api/subjects` that does not take that lock.
 */
export function createCaptureConfirmService(opts: {
  runInTransaction: RunInTransaction;
  clock: () => Date;
  /** How long a confirmation waits for another one of the same user before answering 429. */
  lockTimeoutMs?: number;
}) {
  const { runInTransaction, clock } = opts;
  const lockTimeoutMs = Math.trunc(opts.lockTimeoutMs ?? 10_000);

  return {
    async confirm(actor: Actor, input: CaptureConfirmInput): Promise<CaptureConfirmResponse> {
      return runInTransaction(async (tx) => {
        // Bounded wait: a confirmation queued behind another one holds a connection, so it gives up with a clear answer.
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`;
        try {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`capture-confirm:${actor.id}`}, 0))`;
        } catch (err) {
          if (/lock timeout|55P03/i.test(String(err))) {
            throw new AppError(429, 'CAPTURE_IN_PROGRESS', CAPTURE_CONFIRM_MESSAGES.IN_PROGRESS);
          }
          throw err;
        }

        const periods = createPeriodLookup(tx);
        const subjects = createSubjectRepository(tx);
        const activityRepo = createActivityRepository(tx);
        // The Activity service, bound to this transaction: its own "run in a transaction" simply runs in this one.
        const activityService = createActivityService(
          activityRepo,
          subjects,
          periods,
          clock,
          (fn) => fn(tx),
        );

        // The period is the user's CURRENT one, read after the lock: the client never says which.
        const period = await periods.findCurrent(actor.id);
        if (!period) {
          throw new AppError(
            400,
            'NO_CURRENT_PERIOD',
            'Configura tu periodo académico antes de crear actividades.',
          );
        }

        // 1. Subjects: the ones the items name, resolved or created once each.
        const existing = await subjects.list(actor.id, period.id);
        const byKey = new Map(existing.map((s) => [s.nameKey, s]));
        const known = new Map(existing.map((s) => [s.id, s.name]));
        const usedColors = existing.map((s) => s.color);
        const createdRows: Parameters<typeof toSubjectDto>[0][] = [];
        const reused = new Set<string>();
        const resolvedNew = new Map<string, string>(); // name key -> subject id

        for (const item of input.items) {
          if (item.subject.kind !== 'NEW') continue;
          const key = normalizeNameKey(item.subject.name);
          if (resolvedNew.has(key)) continue;
          const already = byKey.get(key);
          if (already) {
            resolvedNew.set(key, already.id);
            reused.add(already.id);
            continue;
          }
          const { subject, created } = await subjects.createIfAbsent({
            userId: actor.id,
            periodId: period.id,
            name: item.subject.name,
            nameKey: key,
            color: pickSubjectColor(usedColors),
            professor: null,
            description: null,
          });
          usedColors.push(subject.color);
          resolvedNew.set(key, subject.id);
          if (created) createdRows.push(subject);
          else {
            // Someone created it meanwhile (a plain POST /api/subjects): it is reused.
            known.set(subject.id, subject.name);
            reused.add(subject.id);
          }
        }

        // 2. Exact copies of activities the student already has (same title, type, subject and deadline).
        const dueAts = input.items.map(
          (i) => dueFromLocal({ date: i.dueDate, time: i.dueTime }, actor.timezone).dueAt,
        );
        const from = new Date(Math.min(...dueAts.map((d) => d.getTime())));
        const to = new Date(Math.max(...dueAts.map((d) => d.getTime())));
        const present = await activityRepo.list(actor.id, { dueFrom: from, dueTo: to });
        const isCopy = (
          i: number,
          subjectId: string | null,
          item: CaptureConfirmInput['items'][number],
        ) =>
          present.some(
            (a) =>
              a.subjectId === subjectId &&
              a.type === item.type &&
              a.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
              a.dueAt.getTime() === dueAts[i]!.getTime(),
          );

        // 3. Save every activity. One that the rules refuse is recorded and the others still run, so the student gets ALL
        // the corrections at once; if there is any, the transaction is rolled back at the end.
        const refused: CaptureConfirmItemError[] = [];
        const createdActivities: CaptureConfirmResponse['createdActivities'] = [];

        for (const [i, item] of input.items.entries()) {
          let subjectId: string | null = null;
          if (item.subject.kind === 'EXISTING') {
            // Only the student's own subjects of the CURRENT period: another user's and a missing one answer the same.
            if (!known.has(item.subject.subjectId)) {
              refused.push({
                clientId: item.clientId,
                code: 'SUBJECT_NOT_FOUND',
                message: 'Asignatura no encontrada.',
                fields: { subject: ['Asignatura no encontrada.'] },
              });
              continue;
            }
            subjectId = item.subject.subjectId;
            reused.add(subjectId);
          } else if (item.subject.kind === 'NEW') {
            subjectId = resolvedNew.get(normalizeNameKey(item.subject.name)) ?? null;
          }

          if (item.allowDuplicate !== true && isCopy(i, subjectId, item)) {
            refused.push({
              clientId: item.clientId,
              code: 'DUPLICATE_ACTIVITY',
              message: CAPTURE_CONFIRM_MESSAGES.DUPLICATE_ACTIVITY,
              fields: {},
            });
            continue;
          }

          const parsed = createActivitySchema.safeParse({
            subjectId,
            title: item.title,
            dueDate: item.dueDate,
            dueTime: item.dueTime,
            type: item.type,
            priority: item.priority,
            description: item.description,
          });
          if (!parsed.success) {
            refused.push({
              clientId: item.clientId,
              code: 'VALIDATION_ERROR',
              message: 'Revisa los campos marcados.',
              fields: fieldErrorsOf(parsed.error),
            });
            continue;
          }
          try {
            createdActivities.push({
              clientId: item.clientId,
              activity: await activityService.create(actor, parsed.data),
            });
          } catch (err) {
            // A rule of the Activity service about this item. Anything else (a database failure) ends the confirmation.
            if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
              refused.push({
                clientId: item.clientId,
                code: 'VALIDATION_ERROR',
                message: err.message,
                fields:
                  (err.details as { fields?: Record<string, string[]> } | undefined)?.fields ?? {},
              });
              continue;
            }
            throw err;
          }
        }

        if (refused.length > 0) {
          const copiesOnly = refused.every((r) => r.code === 'DUPLICATE_ACTIVITY');
          throw new AppError(
            copiesOnly ? 409 : 400,
            copiesOnly ? 'DUPLICATE_ACTIVITY' : 'VALIDATION_ERROR',
            copiesOnly
              ? CAPTURE_CONFIRM_MESSAGES.DUPLICATE_ACTIVITY
              : CAPTURE_CONFIRM_MESSAGES.REJECTED,
            { items: refused },
          );
        }

        return {
          createdActivities,
          createdSubjects: createdRows.map(toSubjectDto),
          reusedSubjects: [...reused].map((id) => ({ id, name: known.get(id) ?? '' })),
          count: createdActivities.length,
        };
      }, TRANSACTION);
    },
  };
}

export type CaptureConfirmService = ReturnType<typeof createCaptureConfirmService>;
