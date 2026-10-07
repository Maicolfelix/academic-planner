import {
  DUPLICATE_CLASS_MESSAGE,
  createScheduleBlockSchema,
  fieldErrorsOf,
  findDuplicateClass,
  planImportSubjects,
  toScheduleBlockInput,
  type ConfirmImportItemError,
  type ConfirmScheduleImportInput,
  type ConfirmScheduleImportResponse,
  type ExistingClass,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { toDateOnly, toSubjectDto } from '../mappers.js';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { createScheduleRepository } from '../repositories/scheduleRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';
import { windowOf } from './scheduleOccurrences.js';
import { createScheduleService } from './scheduleService.js';

/**
 * Confirmation of a reviewed schedule import: the NEW subjects and every class, in ONE database transaction. Either
 * all of it is saved or none of it is.
 *
 * The rules are not rewritten here: the classes go through the same Schedule service as `POST /api/schedule` (period
 * limits, subject ownership and period, conflict handling, instants), bound to the transaction's connection.
 * What this service adds is only what a batch needs: resolving which subjects exist, creating the missing ones
 * (name key, color and period come from the server), refusing duplicates and reporting every refused class at once.
 *
 * Concurrency: confirmations of the same user take a transaction-level advisory lock, so two at the same time run one
 * after the other and the second sees the first's subjects and classes (a double click can create neither twice).
 * Subjects are also inserted with ON CONFLICT DO NOTHING, which protects against a plain `POST /api/subjects` that
 * does not take that lock.
 */
export function createScheduleImportConfirmService(opts: {
  runInTransaction: RunInTransaction;
  clock: () => Date;
}) {
  const { runInTransaction, clock } = opts;

  return {
    async confirm(
      actor: Actor,
      input: ConfirmScheduleImportInput,
    ): Promise<ConfirmScheduleImportResponse> {
      return runInTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule-import:${actor.id}`}, 0))`;

        const periods = createPeriodLookup(tx);
        const subjects = createSubjectRepository(tx);
        const schedule = createScheduleRepository(tx);
        const scheduleService = createScheduleService(schedule, periods, subjects, clock);

        // The period is the user's CURRENT one, read after the lock: the client never says which.
        const period = await periods.findCurrent(actor.id);
        if (!period) {
          throw new AppError(
            400,
            'NO_CURRENT_PERIOD',
            'Configura tu periodo académico antes de importar tu horario.',
          );
        }
        const days = { from: toDateOnly(period.startDate), to: toDateOnly(period.endDate) };

        // 1. Which subjects the classes need (pure rules in core); create the ones that do not exist.
        const existing = await subjects.list(actor.id, period.id);
        const plan = planImportSubjects(input.classes, existing);
        const byKey = new Map<string, { id: string; name: string }>();
        const createdRows: Parameters<typeof toSubjectDto>[0][] = [];
        const known = new Map(existing.map((s) => [s.id, s.name]));
        for (const n of plan.toCreate) {
          const { subject, created } = await subjects.createIfAbsent({
            userId: actor.id,
            periodId: period.id,
            name: n.name,
            nameKey: n.key,
            color: n.color,
            professor: null,
            description: null,
          });
          byKey.set(n.key, subject);
          if (created) createdRows.push(subject);
          else known.set(subject.id, subject.name); // someone created it meanwhile: it is reused
        }

        // 2. The classes already in the period's agenda, to refuse a class that is already there. Classes created
        // by this same request are added as they are saved, so a repeated class inside the batch is caught too.
        const rows = await schedule.candidates(actor.id, {
          ...windowOf(days, actor.timezone),
          types: ['CLASS'],
          periodId: period.id,
        });
        const present: ExistingClass[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          subjectId: r.subjectId,
          startAt: r.startAt,
          endAt: r.endAt,
          recurring: r.recurrenceType === 'WEEKLY' && r.recurrenceUntil !== null,
        }));

        // 3. Save every class. A class the rules refuse is recorded and the others still run, so the student gets
        // ALL the corrections at once; if there is any, the transaction is rolled back at the end.
        const refused: ConfirmImportItemError[] = [];
        const createdBlocks: ConfirmScheduleImportResponse['createdBlocks'] = [];
        const usedExisting = new Set<string>();

        for (const [i, c] of input.classes.entries()) {
          const { target } = plan.targets[i]!;
          const subjectId =
            target.kind === 'EXISTING' ? target.subjectId : byKey.get(target.key)!.id;

          const parsed = createScheduleBlockSchema.safeParse(
            toScheduleBlockInput(c, subjectId, days.from),
          );
          if (!parsed.success) {
            refused.push({
              clientId: c.clientId,
              code: 'VALIDATION_ERROR',
              message: 'Revisa los campos marcados.',
              fields: fieldErrorsOf(parsed.error),
            });
            continue;
          }

          if (
            findDuplicateClass(
              { subjectId, weekday: c.weekday, startTime: c.startTime, endTime: c.endTime },
              present,
              actor.timezone,
            )
          ) {
            refused.push({
              clientId: c.clientId,
              code: 'DUPLICATE_CLASS',
              message: DUPLICATE_CLASS_MESSAGE,
              fields: {},
            });
            continue;
          }

          try {
            const { block } = await scheduleService.create(actor, parsed.data);
            createdBlocks.push({ clientId: c.clientId, block: block! });
            present.push({
              id: block!.id,
              title: block!.title,
              type: 'CLASS',
              subjectId,
              startAt: block!.startAt,
              endAt: block!.endAt,
              recurring: true,
            });
            if (known.has(subjectId)) usedExisting.add(subjectId);
          } catch (err) {
            // A rule of the Schedule service about this class (e.g. a date outside the period). Anything else
            // (a subject that is not the user's: the same 404 as always) ends the whole confirmation.
            if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
              refused.push({
                clientId: c.clientId,
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
          const invalid = refused.some((r) => r.code === 'VALIDATION_ERROR');
          throw new AppError(
            invalid ? 400 : 409,
            invalid ? 'VALIDATION_ERROR' : 'DUPLICATE_CLASS',
            invalid
              ? 'Datos inválidos. Revisa las clases marcadas: no se importó nada.'
              : 'Algunas clases ya están en tu agenda. Quítalas e inténtalo de nuevo: no se importó nada.',
            { items: refused },
          );
        }

        return {
          createdSubjects: createdRows.map(toSubjectDto),
          reusedSubjects: [...usedExisting].map((id) => ({ id, name: known.get(id) ?? '' })),
          createdBlocks,
        };
      });
    },
  };
}

export type ScheduleImportConfirmService = ReturnType<typeof createScheduleImportConfirmService>;
