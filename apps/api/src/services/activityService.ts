import {
  dueFromLocal,
  localDayBounds,
  resolveCompletedAt,
  toLocalParts,
  type CreateActivityInput,
  type ListActivitiesQuery,
  type UpdateActivityInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { notFound } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toActivityDto } from '../mappers.js';
import {
  createActivityRepository,
  type ActivityRepository,
} from '../repositories/activityRepository.js';
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

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

export function createActivityService(
  activities: ActivityRepository,
  subjects: SubjectRepository,
  /** Injected so tests (and future jobs) control "now"; production passes the real clock. */
  clock: () => Date,
  /** Writes that also touch reminders run in ONE transaction: both change, or neither does. */
  runInTransaction: RunInTransaction,
) {
  return {
    async list(actor: Actor, query: ListActivitiesQuery) {
      const rows = await activities.list(actor.id, {
        subjectId: query.subjectId,
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
     * The subject must belong to the authenticated user: one that does not exist and one that
     * belongs to someone else produce the very same 404. A new activity is always PENDING and starts
     * with the automatic reminders for its type — created in the same transaction as the activity.
     */
    async create(actor: Actor, input: CreateActivityInput) {
      if (!(await subjects.findOwned(actor.id, input.subjectId))) throw subjectNotFound();
      const { dueAt, hasTime } = dueFromLocal(
        { date: input.dueDate, time: input.dueTime },
        actor.timezone,
      );
      try {
        const created = await runInTransaction(async (tx) => {
          const row = await createActivityRepository(tx).create({
            userId: actor.id,
            subjectId: input.subjectId,
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
        // The subject was deleted between the check and the insert: the foreign key says no.
        if (isPrismaError(err, 'P2003')) throw subjectNotFound();
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

          const moving = input.subjectId !== undefined && input.subjectId !== existing.subjectId;
          if (moving && !(await subjects.findOwned(actor.id, input.subjectId!)))
            throw subjectNotFound();

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
