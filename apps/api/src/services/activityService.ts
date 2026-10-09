import {
  activityToIcs,
  NO_SUBJECT_FILTER,
  dueFromLocal,
  localDayBounds,
  resolveCompletedAt,
  toLocalParts,
  type CreateActivityInput,
  type ListActivitiesQuery,
  type UpdateActivityInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError, notFound, validationError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toActivityDto } from '../mappers.js';
import {
  createActivityRepository,
  type ActivityRepository,
} from '../repositories/activityRepository.js';
import type { PeriodLookup } from '../repositories/periodRepository.js';
import { createReminderRepository } from '../repositories/reminderRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import { createRemindersFor, syncRemindersAfterChange } from './reminderSync.js';

/** The part of the session user the rules need: who owns the data and which timezone they live in. */
export interface Actor {
  id: string;
  timezone: string;
}

const activityNotFound = () => notFound('Actividad no encontrada.');
const subjectNotFound = () => notFound('Asignatura no encontrada.');
/** Same code the Agenda uses for the same situation (no current period to anchor the record to). */
const noCurrentPeriod = () =>
  new AppError(
    400,
    'NO_CURRENT_PERIOD',
    'Configura tu periodo académico antes de crear actividades.',
  );

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

export function createActivityService(
  activities: ActivityRepository,
  subjects: SubjectRepository,
  /** Only the current-period lookup: a general activity (no subject) is anchored to the user's current period. */
  periods: Pick<PeriodLookup, 'findCurrent'>,
  /** Injected so tests (and future jobs) control "now"; production passes the real clock. */
  clock: () => Date,
  /** Writes that also touch reminders run in ONE transaction: both change, or neither does. */
  runInTransaction: RunInTransaction,
) {
  return {
    async list(actor: Actor, query: ListActivitiesQuery) {
      const rows = await activities.list(actor.id, {
        // `none` selects the general activities (no subject); anything else is a subject id.
        subjectId: query.subjectId === NO_SUBJECT_FILTER ? null : query.subjectId,
        periodId: query.periodId,
        status: query.status,
        priority: query.priority,
        type: query.type,
        // `from`/`to` are the user's local days, inclusive on both ends.
        dueFrom: query.from ? localDayBounds(query.from, actor.timezone).start : undefined,
        dueTo: query.to ? localDayBounds(query.to, actor.timezone).end : undefined,
        overdue: query.overdue === undefined ? undefined : { now: clock(), value: query.overdue },
        radar: query.radar ? { now: clock(), status: query.radar } : undefined,
      });
      return rows.map(toActivityDto);
    },

    async get(actor: Actor, id: string) {
      const activity = await activities.findOwned(actor.id, id);
      if (!activity) throw activityNotFound();
      return toActivityDto(activity);
    },

    /**
     * The `.ics` of one activity ("Añadir al calendario"): the same ownership rule as `get` (foreign and absent are
     * the same 404). Read-only: nothing is stored, and the output depends only on the stored data, not on the clock.
     */
    async calendarExport(actor: Actor, id: string) {
      const activity = await activities.findOwned(actor.id, id);
      if (!activity) throw activityNotFound();
      // A general activity has no subject to look up: the calendar entry is just its title.
      const subject = activity.subjectId
        ? await subjects.findOwned(actor.id, activity.subjectId)
        : null;
      return activityToIcs({
        activity: {
          id: activity.id,
          title: activity.title,
          dueAt: activity.dueAt.toISOString(),
          hasTime: activity.hasTime,
          updatedAt: activity.updatedAt.toISOString(),
        },
        subject: subject
          ? { name: subject.name, updatedAt: subject.updatedAt.toISOString() }
          : null,
        timeZone: actor.timezone,
      });
    },

    /**
     * The client never sends the period: it is derived here. With a subject the activity takes the subject's period
     * (which must belong to the authenticated user: one that does not exist and one that belongs to someone else
     * produce the very same 404); without one it takes the user's CURRENT period. A new activity is always PENDING and
     * starts with the automatic reminders for its type — created in the same transaction as the activity.
     */
    async create(actor: Actor, input: CreateActivityInput) {
      const subjectId = input.subjectId ?? null;
      let periodId: string;
      if (subjectId) {
        const subject = await subjects.findOwned(actor.id, subjectId);
        if (!subject) throw subjectNotFound();
        periodId = subject.periodId;
      } else {
        const period = await periods.findCurrent(actor.id);
        if (!period) throw noCurrentPeriod();
        periodId = period.id;
      }
      const { dueAt, hasTime } = dueFromLocal(
        { date: input.dueDate, time: input.dueTime },
        actor.timezone,
      );
      try {
        const created = await runInTransaction(async (tx) => {
          const row = await createActivityRepository(tx).create({
            userId: actor.id,
            periodId,
            subjectId,
            title: input.title,
            description: input.description ?? null,
            type: input.type,
            priority: input.priority,
            dueAt,
            hasTime,
          });
          await createRemindersFor(createReminderRepository(tx), row, clock());
          return row;
        });
        return toActivityDto(created);
      } catch (err) {
        // The subject (or the period) was deleted between the check and the insert: the foreign key says no.
        if (isPrismaError(err, 'P2003')) throw subjectId ? subjectNotFound() : noCurrentPeriod();
        throw err;
      }
    },

    async update(actor: Actor, id: string, input: UpdateActivityInput) {
      try {
        const updated = await runInTransaction(async (tx) => {
          const txActivities = createActivityRepository(tx);

          // Lock first, THEN read: two simultaneous edits wait for each other and each one sees the
          // other's result, so neither a merged date/time nor the reminders can end up inconsistent.
          if (!(await txActivities.lock(actor.id, id))) throw activityNotFound();
          const existing = await txActivities.findOwned(actor.id, id);
          if (!existing) throw activityNotFound();

          // Absent: untouched. null: detach (the period stays). A uuid: it must be the user's own AND from the
          // activity's period — an activity never changes period (the composite foreign key backs this up).
          const moving = input.subjectId !== undefined && input.subjectId !== existing.subjectId;
          if (moving && input.subjectId) {
            const subject = await subjects.findOwned(actor.id, input.subjectId);
            if (!subject) throw subjectNotFound();
            if (subject.periodId !== existing.periodId)
              throw validationError({
                subjectId: ['La asignatura debe pertenecer al mismo periodo.'],
              });
          }

          // Sending only the date keeps the stored time (and the other way round); dueTime null drops it.
          let due: { dueAt: Date; hasTime: boolean } | undefined;
          if (input.dueDate !== undefined || input.dueTime !== undefined) {
            const current = toLocalParts(existing.dueAt, actor.timezone);
            due = dueFromLocal(
              {
                date: input.dueDate ?? current.date,
                time:
                  input.dueTime === undefined
                    ? existing.hasTime
                      ? current.time
                      : null
                    : input.dueTime,
              },
              actor.timezone,
            );
          }

          const now = clock();
          const next = await txActivities.update(actor.id, id, {
            ...(moving && { subjectId: input.subjectId }),
            ...(input.title !== undefined && { title: input.title }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.type !== undefined && { type: input.type }),
            ...(input.priority !== undefined && { priority: input.priority }),
            ...(due && due),
            // status and completedAt are written together, so they can never disagree.
            ...(input.status !== undefined && {
              status: input.status,
              completedAt: resolveCompletedAt(existing, input.status, now),
            }),
          });

          // Reminders follow ONLY the deadline, the type and finishing/reopening (see planReminderChange).
          await syncRemindersAfterChange(createReminderRepository(tx), existing, next, now);
          return next;
        });
        return toActivityDto(updated);
      } catch (err) {
        if (isPrismaError(err, 'P2025')) throw activityNotFound();
        if (isPrismaError(err, 'P2003')) throw subjectNotFound();
        throw err;
      }
    },

    /** The foreign key (ON DELETE CASCADE) removes the activity's reminders with it. */
    async remove(actor: Actor, id: string) {
      if (!(await activities.delete(actor.id, id))) throw activityNotFound();
    },
  };
}

export type ActivityService = ReturnType<typeof createActivityService>;
