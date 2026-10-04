import {
  blockInstants,
  findConflicts,
  formatDateOnly,
  SCHEDULE_CONFLICT_MESSAGE,
  toLocalParts,
  weekRangeOf,
  type CreateScheduleBlockInput,
  type ScheduleBlockType,
  type ScheduleWarning,
  type UpdateScheduleBlockInput,
} from '@planner/core';
import { AppError, notFound, validationError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  fromDateOnly,
  toBlockLike,
  toDateOnly,
  toScheduleBlockDto,
  type ScheduleBlockRow,
} from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { ScheduleRepository } from '../repositories/scheduleRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';
import { occurrencesInRange, windowOf } from './scheduleOccurrences.js';

const blockNotFound = () => notFound('Bloque de agenda no encontrado.');
const subjectNotFound = () => notFound('Asignatura no encontrada.');
const periodNotFound = () => notFound('Periodo no encontrado.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

/** Everything a stored block is made of, once defaults and the user's input have been merged. */
interface Draft {
  type: ScheduleBlockType;
  subjectId: string | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  until: string | null;
}

interface PeriodDays {
  id: string;
  startDate: Date;
  endDate: Date;
}

export interface WriteResult {
  /** null on a dry run: nothing was saved. */
  block: ReturnType<typeof toScheduleBlockDto> | null;
  warnings: ScheduleWarning[];
}

export function createScheduleService(
  schedule: ScheduleRepository,
  periods: PeriodRepository,
  subjects: SubjectRepository,
  /** Injected so the default week (and tests) control "now". */
  clock: () => Date,
) {
  /** The rules that need stored data: the subject, the period's days, the class/subject link. */
  async function validate(actor: Actor, period: PeriodDays, draft: Draft) {
    if (draft.subjectId) {
      const subject = await subjects.findOwned(actor.id, draft.subjectId);
      if (!subject) throw subjectNotFound();
      if (subject.periodId !== period.id) {
        throw validationError({ subjectId: ['La asignatura debe pertenecer al mismo periodo.'] });
      }
    } else if (draft.type === 'CLASS') {
      throw validationError({ subjectId: ['Elige la asignatura de la clase.'] });
    }

    const from = toDateOnly(period.startDate);
    const to = toDateOnly(period.endDate);
    const range = `${formatDateOnly(from)} – ${formatDateOnly(to)}`;
    if (draft.date < from || draft.date > to) {
      throw validationError({ date: [`La fecha debe estar dentro del periodo (${range}).`] });
    }
    if (draft.until !== null) {
      if (draft.until < draft.date) {
        throw validationError({
          recurrence: [
            'La fecha final de la repetición no puede ser anterior a la fecha de inicio.',
          ],
        });
      }
      if (draft.until > to) {
        throw validationError({
          recurrence: [
            `La repetición no puede terminar después del fin del periodo (${formatDateOnly(to)}).`,
          ],
        });
      }
    }
  }

  /** Conflicts are WARNINGS: they are reported, never enforced, and never block saving. */
  async function conflictsFor(actor: Actor, period: PeriodDays, draft: Draft, selfId?: string) {
    const { startAt, endAt } = blockInstants(draft, actor.timezone);
    const candidate = {
      id: selfId,
      startAt,
      endAt,
      recurrenceUntil: draft.until,
      bounds: { from: toDateOnly(period.startDate), to: toDateOnly(period.endDate) },
    };
    // Look at the candidate's whole span: one day for a single block, the whole series otherwise.
    const lastDay = draft.until ?? toLocalParts(endAt, actor.timezone).date;
    const rows = await schedule.candidates(
      actor.id,
      windowOf({ from: draft.date, to: lastDay }, actor.timezone),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    return findConflicts(
      candidate,
      rows.map((r) => ({ id: r.id, ...toBlockLike(r) })),
      actor.timezone,
    ).map((c): ScheduleWarning => {
      const other = byId.get(c.blockId)!;
      return {
        code: 'SCHEDULE_CONFLICT',
        message: SCHEDULE_CONFLICT_MESSAGE,
        with: {
          blockId: other.id,
          title: other.title,
          type: other.type,
          startAt: c.first.startAt.toISOString(),
          endAt: c.first.endAt.toISOString(),
          occurrences: c.occurrences,
        },
      };
    });
  }

  const toDto = (row: ScheduleBlockRow, actor: Actor) => toScheduleBlockDto(row, actor.timezone);

  return {
    /**
     * Occurrences inside [from, to] (the user's local days; the current Monday–Sunday week when omitted).
     * Only that range is expanded: a semester-long series costs the same as a one-week one.
     */
    async list(actor: Actor, query: { from?: string; to?: string }) {
      const range =
        query.from && query.to
          ? { from: query.from, to: query.to }
          : weekRangeOf(toLocalParts(clock(), actor.timezone).date);
      const rows = await schedule.candidates(actor.id, windowOf(range, actor.timezone));
      return { range, occurrences: occurrencesInRange(rows, range, actor.timezone) };
    },

    async get(actor: Actor, id: string) {
      const row = await schedule.findOwned(actor.id, id);
      if (!row) throw blockNotFound();
      return toDto(row, actor);
    },

    /**
     * Creates one block or one weekly series. Ownership: the period and the subject must be the
     * user's own — a foreign or unknown one gives the same 404. `dryRun` validates everything and
     * reports conflicts without saving, so the UI can warn before the user commits.
     */
    async create(
      actor: Actor,
      input: CreateScheduleBlockInput,
      opts: { dryRun?: boolean } = {},
    ): Promise<WriteResult> {
      const period = input.periodId
        ? await periods.findOwned(actor.id, input.periodId)
        : await periods.findCurrent(actor.id);
      if (!period) {
        if (input.periodId) throw periodNotFound();
        throw new AppError(
          400,
          'NO_CURRENT_PERIOD',
          'Configura tu periodo académico antes de usar la agenda.',
        );
      }

      const draft: Draft = {
        type: input.type,
        subjectId: input.subjectId ?? null,
        title: input.title,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        until: input.recurrence?.until ?? null,
      };
      await validate(actor, period, draft);
      const warnings = await conflictsFor(actor, period, draft);
      if (opts.dryRun) return { block: null, warnings };

      try {
        const { startAt, endAt } = blockInstants(draft, actor.timezone);
        const row = await schedule.create({
          userId: actor.id,
          periodId: period.id,
          subjectId: draft.subjectId,
          title: draft.title,
          type: draft.type,
          startAt,
          endAt,
          recurrenceType: draft.until ? 'WEEKLY' : 'NONE',
          recurrenceUntil: draft.until ? fromDateOnly(draft.until) : null,
        });
        return { block: toDto(row, actor), warnings };
      } catch (err) {
        // The subject or period vanished between the check and the insert: the foreign key says no.
        if (isPrismaError(err, 'P2003'))
          throw draft.subjectId ? subjectNotFound() : periodNotFound();
        throw err;
      }
    },

    /** Editing a series edits ALL of its weeks: there are no per-occurrence exceptions. */
    async update(
      actor: Actor,
      id: string,
      input: UpdateScheduleBlockInput,
      opts: { dryRun?: boolean } = {},
    ): Promise<WriteResult> {
      const existing = await schedule.findOwned(actor.id, id);
      if (!existing) throw blockNotFound();

      const start = toLocalParts(existing.startAt, actor.timezone);
      const end = toLocalParts(existing.endAt, actor.timezone);
      const draft: Draft = {
        type: input.type ?? existing.type,
        subjectId: input.subjectId !== undefined ? input.subjectId : existing.subjectId,
        title: input.title ?? existing.title,
        date: input.date ?? start.date,
        startTime: input.startTime ?? start.time,
        endTime: input.endTime ?? end.time,
        until:
          input.recurrence === undefined
            ? existing.recurrenceUntil
              ? toDateOnly(existing.recurrenceUntil)
              : null
            : (input.recurrence?.until ?? null),
      };
      // The schema only compares the times present in the request; the other half comes from storage.
      if (draft.endTime <= draft.startTime) {
        throw validationError({ endTime: ['La hora de fin debe ser posterior a la de inicio.'] });
      }

      const periodDays = { id: existing.periodId, ...existing.period };
      await validate(actor, periodDays, draft);
      const warnings = await conflictsFor(actor, periodDays, draft, existing.id);
      if (opts.dryRun) return { block: null, warnings };

      try {
        const { startAt, endAt } = blockInstants(draft, actor.timezone);
        const row = await schedule.update(actor.id, id, {
          subjectId: draft.subjectId,
          title: draft.title,
          type: draft.type,
          startAt,
          endAt,
          recurrenceType: draft.until ? 'WEEKLY' : 'NONE',
          recurrenceUntil: draft.until ? fromDateOnly(draft.until) : null,
        });
        return { block: toDto(row, actor), warnings };
      } catch (err) {
        if (isPrismaError(err, 'P2025')) throw blockNotFound();
        if (isPrismaError(err, 'P2003')) throw subjectNotFound();
        throw err;
      }
    },

    /** Deleting a series deletes the whole rule; there is nothing else to clean up. */
    async remove(actor: Actor, id: string) {
      if (!(await schedule.delete(actor.id, id))) throw blockNotFound();
    },
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;
