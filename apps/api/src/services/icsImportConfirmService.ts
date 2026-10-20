import {
  ICS_DUPLICATE_ACTIVITY_MESSAGE,
  createActivitySchema,
  createScheduleBlockSchema,
  dueFromLocal,
  fieldErrorsOf,
  findDuplicateBlock,
  type ConfirmIcsImportInput,
  type ConfirmIcsImportResponse,
  type ExistingClass,
  type IcsItemError,
  type Weekday,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { toDateOnly } from '../mappers.js';
import { createActivityRepository } from '../repositories/activityRepository.js';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { createScheduleRepository } from '../repositories/scheduleRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { createActivityService, type Actor } from './activityService.js';
import { windowOf } from './scheduleOccurrences.js';
import { createScheduleService } from './scheduleService.js';

const TRANSACTION_LOCK_MS = 10_000;

/**
 * Confirmation of a reviewed .ics: the chosen activities and classes in ONE transaction — all of it or none. Nothing the server
 * can derive is accepted from the client: the owner, the period of a subject and the end of a repeating class come from the
 * database. A subject is accepted only if it is one of the student's own, of a CURRENT study (a foreign or missing one answers
 * the same). Every item goes through the very same Activity / Schedule services as the manual forms, so their rules (period
 * limits, ownership, reminders, conflicts) are never rewritten here; a class already in the agenda is reused, an exact copy of
 * an activity is refused unless the student insisted, and every refused item is reported at once by its `clientId`.
 * Confirmations of the same user are serialized with an advisory lock, so a double tap cannot create everything twice.
 */
export function createIcsImportConfirmService(opts: {
  runInTransaction: RunInTransaction;
  clock: () => Date;
  lockTimeoutMs?: number;
}) {
  const { runInTransaction, clock } = opts;
  const lockTimeoutMs = Math.trunc(opts.lockTimeoutMs ?? TRANSACTION_LOCK_MS);

  return {
    async confirm(actor: Actor, input: ConfirmIcsImportInput): Promise<ConfirmIcsImportResponse> {
      return runInTransaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`;
        try {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ics-confirm:${actor.id}`}, 0))`;
        } catch (err) {
          if (/lock timeout|55P03/i.test(String(err)))
            throw new AppError(
              429,
              'IMPORT_IN_PROGRESS',
              'Ya estamos importando tu calendario. Espera a que termine.',
            );
          throw err;
        }

        const periods = createPeriodLookup(tx);
        const subjects = createSubjectRepository(tx);
        const activityRepo = createActivityRepository(tx);
        const scheduleRepo = createScheduleRepository(tx);
        const activityService = createActivityService(
          activityRepo,
          subjects,
          periods,
          clock,
          (fn) => fn(tx),
        );
        const scheduleService = createScheduleService(scheduleRepo, periods, subjects, clock);

        // The student's own subjects of their CURRENT, active periods, and those periods.
        const current = await periods.listCurrent(actor.id);
        const periodById = new Map(current.map((p) => [p.id, p]));
        const rows =
          current.length > 0
            ? await subjects.listInPeriods(
                actor.id,
                current.map((p) => p.id),
              )
            : [];
        const subjectById = new Map(rows.map((s) => [s.id, s]));

        const refused: IcsItemError[] = [];
        const refuse = (
          clientId: string,
          code: IcsItemError['code'],
          message: string,
          fields: Record<string, string[]> = {},
        ) => refused.push({ clientId, code, message, fields });

        // Copies of activities already in the agenda (same title, type, subject and deadline).
        const activityItems = input.items.filter((i) => i.kind === 'ACTIVITY');
        const dueOf = (date: string, time?: string | null) =>
          dueFromLocal({ date, time }, actor.timezone).dueAt;
        const present =
          activityItems.length === 0
            ? []
            : await activityRepo.list(actor.id, {
                dueFrom: new Date(
                  Math.min(...activityItems.map((i) => dueOf(i.date, i.startTime).getTime())),
                ),
                dueTo: new Date(
                  Math.max(...activityItems.map((i) => dueOf(i.date, i.startTime).getTime())),
                ),
              });

        let inAgenda: ExistingClass[] | null = null;
        const loadAgenda = async () => {
          if (inAgenda) return inAgenda;
          const starts = current.map((p) => toDateOnly(p.startDate)).sort();
          const ends = current.map((p) => toDateOnly(p.endDate)).sort();
          const rowsInAgenda = await scheduleRepo.candidates(actor.id, {
            ...windowOf({ from: starts[0]!, to: ends.at(-1)! }, actor.timezone),
            types: ['CLASS', 'STUDY'],
            periodIds: current.map((p) => p.id),
          });
          inAgenda = rowsInAgenda.map((r) => ({
            id: r.id,
            title: r.title,
            type: r.type,
            subjectId: r.subjectId,
            startAt: r.startAt,
            endAt: r.endAt,
            recurring: r.recurrenceType === 'WEEKLY' && r.recurrenceUntil !== null,
            until: r.recurrenceUntil ? toDateOnly(r.recurrenceUntil) : null,
          }));
          return inAgenda;
        };

        const response: ConfirmIcsImportResponse = {
          createdActivities: [],
          createdBlocks: [],
          reusedBlocks: [],
        };

        for (const item of input.items) {
          const subject =
            item.subjectId === null ? null : (subjectById.get(item.subjectId) ?? null);
          if (item.subjectId !== null && !subject) {
            refuse(item.clientId, 'SUBJECT_NOT_FOUND', 'Asignatura no encontrada.', {
              subject: ['Asignatura no encontrada.'],
            });
            continue;
          }

          if (item.kind === 'ACTIVITY') {
            const type = item.type ?? 'TASK';
            const dueAt = dueOf(item.date, item.startTime);
            const copy = present.some(
              (a) =>
                a.subjectId === (subject?.id ?? null) &&
                a.type === type &&
                a.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
                a.dueAt.getTime() === dueAt.getTime(),
            );
            if (copy && item.allowDuplicate !== true) {
              refuse(item.clientId, 'DUPLICATE_ACTIVITY', ICS_DUPLICATE_ACTIVITY_MESSAGE);
              continue;
            }
            const parsed = createActivitySchema.safeParse({
              subjectId: subject?.id ?? null,
              title: item.title,
              dueDate: item.date,
              dueTime: item.startTime ?? undefined,
              type,
              description: item.description ?? undefined,
            });
            if (!parsed.success) {
              refuse(
                item.clientId,
                'VALIDATION_ERROR',
                'Revisa los campos marcados.',
                fieldErrorsOf(parsed.error),
              );
              continue;
            }
            try {
              const activity = await activityService.create(actor, parsed.data);
              response.createdActivities.push({
                clientId: item.clientId,
                id: activity.id,
                title: activity.title,
              });
            } catch (err) {
              if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
                refuse(
                  item.clientId,
                  'VALIDATION_ERROR',
                  err.message,
                  (err.details as { fields?: Record<string, string[]> } | undefined)?.fields ?? {},
                );
                continue;
              }
              throw err;
            }
            continue;
          }

          // A class (or a single block) belongs to a subject, and to the period of that subject.
          if (!subject) {
            refuse(item.clientId, 'VALIDATION_ERROR', 'Elige la asignatura de la clase.', {
              subject: ['Elige la asignatura de la clase.'],
            });
            continue;
          }
          const period = periodById.get(subject.periodId)!;
          const periodEnd = toDateOnly(period.endDate);
          const weekly = item.weekly === true;
          // The series ends where the file says, never after the period; without an end it runs to the end of the period.
          const until = weekly
            ? item.until && item.until < periodEnd
              ? item.until
              : periodEnd
            : null;
          const parsed = createScheduleBlockSchema.safeParse({
            type: 'CLASS',
            subjectId: subject.id,
            periodId: subject.periodId,
            title: item.title,
            date: item.date,
            startTime: item.startTime,
            endTime: item.endTime,
            recurrence: weekly ? { frequency: 'WEEKLY', until } : null,
          });
          if (!parsed.success) {
            refuse(
              item.clientId,
              'VALIDATION_ERROR',
              'Revisa los campos marcados.',
              fieldErrorsOf(parsed.error),
            );
            continue;
          }
          if (weekly) {
            const agenda = await loadAgenda();
            const weekday = Number(new Date(`${item.date}T12:00:00Z`).getUTCDay() || 7) as Weekday;
            const duplicate = findDuplicateBlock(
              {
                type: 'CLASS',
                subjectId: subject.id,
                weekday,
                startTime: item.startTime!,
                endTime: item.endTime!,
                range: { from: item.date, until: until! },
              },
              agenda,
              actor.timezone,
            );
            if (duplicate) {
              response.reusedBlocks.push({
                clientId: item.clientId,
                id: duplicate.id,
                title: duplicate.title,
              });
              continue;
            }
          }
          try {
            const { block } = await scheduleService.create(actor, parsed.data);
            response.createdBlocks.push({
              clientId: item.clientId,
              id: block!.id,
              title: block!.title,
            });
            if (weekly && inAgenda)
              (inAgenda as ExistingClass[]).push({
                id: block!.id,
                title: block!.title,
                type: 'CLASS',
                subjectId: subject.id,
                startAt: block!.startAt,
                endAt: block!.endAt,
                recurring: true,
                until,
              });
          } catch (err) {
            if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
              refuse(
                item.clientId,
                'VALIDATION_ERROR',
                err.message,
                (err.details as { fields?: Record<string, string[]> } | undefined)?.fields ?? {},
              );
              continue;
            }
            throw err;
          }
        }

        if (refused.length > 0)
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Revisa los eventos marcados: no se importó nada.',
            { items: refused },
          );
        return response;
      }, TRANSACTION);
    },
  };
}

const TRANSACTION = { maxWait: 5_000, timeout: 30_000 };

export type IcsImportConfirmService = ReturnType<typeof createIcsImportConfirmService>;
