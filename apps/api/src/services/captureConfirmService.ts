import {
  CAPTURE_CONFIRM_MESSAGES,
  normalizeNameKey as nameKeyOf,
  createScheduleBlockSchema,
  dueFromLocal,
  fieldErrorsOf,
  findDuplicateBlock,
  firstWeekdayOnOrAfter,
  normalizeNameKey,
  pickSubjectColor,
  createActivitySchema,
  type CaptureConfirmInput,
  type CaptureConfirmItemError,
  type CaptureConfirmResponse,
  type ExistingClass,
  type Weekday,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { toDateOnly, toSubjectDto } from '../mappers.js';
import { createActivityRepository } from '../repositories/activityRepository.js';
import { createGradingRepository } from '../repositories/gradingRepository.js';
import { createPeriodLookup, createPeriodRepository } from '../repositories/periodRepository.js';
import { createStudyTrackRepository } from '../repositories/studyTrackRepository.js';
import { createScheduleRepository } from '../repositories/scheduleRepository.js';
import { createProfileRepository } from '../repositories/profileRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { createSubjectMaterializer } from './subjectMaterializer.js';
import { createActivityService, type Actor } from './activityService.js';
import { createGradingService } from './gradingService.js';
import { windowOf } from './scheduleOccurrences.js';
import { createScheduleService } from './scheduleService.js';

/** Ten activities and their reminders are a few dozen queries: well within this, even on a remote database. */
const TRANSACTION = { maxWait: 5_000, timeout: 30_000 };

/**
 * Confirmation of the proposals of one capture: the NEW subjects, every activity AND every weekly schedule block, in ONE
 * database transaction. Either all of it is saved or none of it is.
 *
 * The rules are not rewritten here: each activity goes through the very same Activity service as `POST /api/activities`
 * (ownership of the subject, the period derived from it or from the current one, the instant, the automatic reminders),
 * and each block through the very same Schedule service as `POST /api/schedule` (period limits, subject ownership and
 * period, conflicts), both bound to the transaction's connection. The first date of a series, its last day and the
 * period are the SERVER's: a block with the same type, subject, weekday and times that is already in the agenda is reused,
 * not duplicated. What this service adds is only what a batch needs: resolving which subjects
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
        const materializer = createSubjectMaterializer(
          subjects,
          createProfileRepository(tx),
          periods,
          {
            readOnce: true,
          },
        );
        const activityRepo = createActivityRepository(tx);
        // The Activity service, bound to this transaction: its own "run in a transaction" simply runs in this one.
        const activityService = createActivityService(
          activityRepo,
          subjects,
          periods,
          clock,
          (fn) => fn(tx),
        );
        const scheduleRepo = createScheduleRepository(tx);
        const scheduleService = createScheduleService(scheduleRepo, periods, subjects, clock);

        // The HOME current period (a general one, else the primary study's), read after the lock: the client never says which.
        const period = await periods.findHomeCurrent(actor.id);
        if (!period && (input.items.length > 0 || input.blocks.length > 0)) {
          throw new AppError(
            400,
            'NO_CURRENT_PERIOD',
            'Configura tu periodo académico antes de crear actividades.',
          );
        }

        // 1. Subjects: the ones the items name, resolved or created once each.
        const existing = period ? await subjects.list(actor.id, period.id) : [];
        const byKey = new Map(existing.map((s) => [s.nameKey, s]));
        const known = new Map(existing.map((s) => [s.id, s.name]));
        const usedColors = existing.map((s) => s.color);
        const createdRows: Parameters<typeof toSubjectDto>[0][] = [];
        const reused = new Set<string>();
        const resolvedNew = new Map<string, string>(); // name key -> subject id

        for (const item of [...input.items, ...input.blocks]) {
          if (item.subject.kind !== 'NEW') continue;
          const key = normalizeNameKey(item.subject.name);
          if (resolvedNew.has(key)) continue;
          const already = byKey.get(key);
          if (already) {
            resolvedNew.set(key, already.id);
            reused.add(already.id);
            continue;
          }
          const { subject, created } = await materializer.createIfAbsent({
            userId: actor.id,
            periodId: period!.id,
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
        const present =
          dueAts.length === 0
            ? []
            : await activityRepo.list(actor.id, { dueFrom: from, dueTo: to });
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

        // 4. The weekly blocks. A block already in the agenda is reused; one the rules refuse is recorded like an activity.
        const createdBlocks: CaptureConfirmResponse['createdBlocks'] = [];
        const reusedBlocks: CaptureConfirmResponse['reusedBlocks'] = [];
        if (input.blocks.length > 0) {
          const days = { from: toDateOnly(period!.startDate), to: toDateOnly(period!.endDate) };
          const rows = await scheduleRepo.candidates(actor.id, {
            ...windowOf(days, actor.timezone),
            types: ['CLASS', 'STUDY'],
            periodId: period!.id,
          });
          const inAgenda: ExistingClass[] = rows.map((r) => ({
            id: r.id,
            title: r.title,
            type: r.type,
            subjectId: r.subjectId,
            startAt: r.startAt,
            endAt: r.endAt,
            recurring: r.recurrenceType === 'WEEKLY' && r.recurrenceUntil !== null,
            until: r.recurrenceUntil ? toDateOnly(r.recurrenceUntil) : null,
          }));

          for (const b of input.blocks) {
            let subjectId: string | null = null;
            if (b.subject.kind === 'EXISTING') {
              if (!known.has(b.subject.subjectId)) {
                refused.push({
                  clientId: b.clientId,
                  code: 'SUBJECT_NOT_FOUND',
                  message: 'Asignatura no encontrada.',
                  fields: { subject: ['Asignatura no encontrada.'] },
                });
                continue;
              }
              subjectId = b.subject.subjectId;
              reused.add(subjectId);
            } else if (b.subject.kind === 'NEW') {
              subjectId = resolvedNew.get(normalizeNameKey(b.subject.name)) ?? null;
            }

            const until = b.until ?? days.to;
            const parsed = createScheduleBlockSchema.safeParse({
              type: b.type,
              subjectId,
              title: b.title,
              date: firstWeekdayOnOrAfter(days.from, b.weekday as Weekday),
              startTime: b.startTime,
              endTime: b.endTime,
              recurrence: { frequency: 'WEEKLY', until },
            });
            if (!parsed.success) {
              refused.push({
                clientId: b.clientId,
                code: 'VALIDATION_ERROR',
                message: 'Revisa los campos marcados.',
                fields: fieldErrorsOf(parsed.error),
              });
              continue;
            }
            const duplicate = findDuplicateBlock(
              {
                type: b.type,
                subjectId,
                weekday: b.weekday,
                startTime: b.startTime,
                endTime: b.endTime,
                range: { from: firstWeekdayOnOrAfter(days.from, b.weekday as Weekday), until },
              },
              inAgenda,
              actor.timezone,
            );
            if (duplicate) {
              reusedBlocks.push({ clientId: b.clientId, id: duplicate.id, title: duplicate.title });
              continue;
            }
            try {
              const { block } = await scheduleService.create(actor, parsed.data);
              createdBlocks.push({ clientId: b.clientId, block: block! });
              inAgenda.push({
                id: block!.id,
                title: block!.title,
                type: b.type,
                subjectId,
                startAt: block!.startAt,
                endAt: block!.endAt,
                recurring: true,
                until,
              });
            } catch (err) {
              if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
                refused.push({
                  clientId: b.clientId,
                  code: 'VALIDATION_ERROR',
                  message: err.message,
                  fields:
                    (err.details as { fields?: Record<string, string[]> } | undefined)?.fields ??
                    {},
                });
                continue;
              }
              throw err;
            }
          }
        }

        // 5. The grade actions (B3): scores, cut grades and new evaluations, through the very same Grading service as the grades
        // screen (ownership, same-subject cut, weight sums, scale, direct-vs-breakdown), bound to this transaction.
        const evaluations: CaptureConfirmResponse['evaluations'] = [];
        if (input.evaluations.length > 0) {
          // The weight sums are checked under the user's study lock (the same one the grades routes take).
          await createStudyTrackRepository(tx).lockUser(actor.id);
          const gradingRepo = createGradingRepository(tx);
          const gradingService = createGradingService({
            grading: gradingRepo,
            subjects,
            activities: activityRepo,
            periods: createPeriodRepository(tx),
            studyTracks: createStudyTrackRepository(tx),
            runInTransaction: (fn) => fn(tx),
            clock,
          });
          const activityOf = new Map(createdActivities.map((c) => [c.clientId, c.activity]));
          const refuse = (
            clientId: string,
            code: CaptureConfirmItemError['code'],
            message: string,
            fields = {},
          ) => refused.push({ clientId, code, message, fields });

          for (const e of input.evaluations) {
            // The subject must be the student's own (any CURRENT period: a grade is not tied to the home period).
            if (!(await subjects.findOwned(actor.id, e.subjectId))) {
              refuse(e.clientId, 'SUBJECT_NOT_FOUND', 'Asignatura no encontrada.', {
                subject: ['Asignatura no encontrada.'],
              });
              continue;
            }
            try {
              if (e.action === 'SET_CUT_GRADE') {
                evaluations.push({
                  clientId: e.clientId,
                  action: e.action,
                  evaluation: await gradingService.createEvaluationInTx(tx, actor.id, {
                    subjectId: e.subjectId,
                    gradingPeriodId: e.gradingPeriodId!,
                    isCutGrade: true,
                    scoreMilli: e.scoreMilli,
                    rawEarnedMilli: e.rawEarnedMilli,
                    rawMaxMilli: e.rawMaxMilli,
                  }),
                });
              } else if (e.action === 'CREATE_EVALUATION') {
                // A copy of an evaluation the subject already has in that cut (a retry, a double tap): never created twice.
                const same = (await gradingRepo.listForSubject(actor.id, e.subjectId)).some(
                  (x) =>
                    x.gradingPeriodId === e.gradingPeriodId &&
                    nameKeyOf(x.name) === nameKeyOf(e.name!),
                );
                if (same) {
                  refuse(
                    e.clientId,
                    'DUPLICATE_EVALUATION',
                    'Ya existe una evaluación con ese nombre en ese corte.',
                  );
                  continue;
                }
                let activityId: string | undefined;
                if (e.activityClientId !== undefined) {
                  const linked = activityOf.get(e.activityClientId);
                  if (!linked || linked.subjectId !== e.subjectId) {
                    refuse(
                      e.clientId,
                      'EVALUATION_CONFLICT',
                      'La actividad enlazada debe ser de la misma asignatura.',
                    );
                    continue;
                  }
                  activityId = linked.id;
                }
                evaluations.push({
                  clientId: e.clientId,
                  action: e.action,
                  evaluation: await gradingService.createEvaluationInTx(tx, actor.id, {
                    subjectId: e.subjectId,
                    gradingPeriodId: e.gradingPeriodId!,
                    name: e.name!,
                    periodShareBp: e.periodShareBp!,
                    ...(e.scoreMilli !== undefined && {
                      scoreMilli: e.scoreMilli,
                      rawEarnedMilli: e.rawEarnedMilli,
                      rawMaxMilli: e.rawMaxMilli,
                    }),
                    ...(activityId && { activityId }),
                  }),
                });
              } else {
                // An update is only applied to what the student SAW: if the evaluation is gone, is not that subject's or its
                // score changed since, a newer score is never overwritten and the student is told.
                const current = await gradingRepo.findEvaluation(actor.id, e.evaluationId!);
                const stale =
                  !current ||
                  current.subjectId !== e.subjectId ||
                  current.scoreMilli !== (e.expectScoreMilli ?? null) ||
                  current.isCutGrade !== (e.action === 'UPDATE_CUT_GRADE');
                if (stale) {
                  refuse(
                    e.clientId,
                    'STALE_EVALUATION',
                    'Esa nota cambió desde que la viste. Revisa y vuelve a intentarlo.',
                  );
                  continue;
                }
                evaluations.push({
                  clientId: e.clientId,
                  action: e.action,
                  evaluation: await gradingService.updateEvaluationInTx(
                    tx,
                    actor.id,
                    e.evaluationId!,
                    {
                      scoreMilli: e.scoreMilli,
                      rawEarnedMilli: e.rawEarnedMilli,
                      rawMaxMilli: e.rawMaxMilli,
                    },
                  ),
                });
              }
            } catch (err) {
              // A rule of the Grading service about this action (a cut that is broken down, a weight over 100 %, a scale…).
              if (err instanceof AppError && err.status < 500) {
                refuse(
                  e.clientId,
                  err.code === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR' : 'EVALUATION_CONFLICT',
                  err.message,
                  (err.details as { fields?: Record<string, string[]> } | undefined)?.fields ?? {},
                );
                continue;
              }
              throw err;
            }
          }
        }

        if (refused.length > 0) {
          const evaluationOnly = refused.every(
            (r) =>
              r.code === 'EVALUATION_CONFLICT' ||
              r.code === 'STALE_EVALUATION' ||
              r.code === 'DUPLICATE_EVALUATION',
          );
          if (evaluationOnly)
            throw new AppError(
              409,
              'EVALUATION_CONFLICT',
              CAPTURE_CONFIRM_MESSAGES.EVALUATION_CONFLICT,
              {
                items: refused,
              },
            );
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
          evaluations,
          createdBlocks,
          reusedBlocks,
        };
      }, TRANSACTION);
    },
  };
}

export type CaptureConfirmService = ReturnType<typeof createCaptureConfirmService>;
