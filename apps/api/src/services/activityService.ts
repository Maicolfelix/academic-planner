import {
  dueFromLocal,
  localDayBounds,
  resolveCompletedAt,
  toLocalParts,
  type CreateActivityInput,
  type ListActivitiesQuery,
  type UpdateActivityInput,
} from '@planner/core';
import { notFound } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toActivityDto } from '../mappers.js';
import type { ActivityRepository } from '../repositories/activityRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';

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
     * belongs to someone else produce the very same 404. A new activity is always PENDING.
     */
    async create(actor: Actor, input: CreateActivityInput) {
      if (!(await subjects.findOwned(actor.id, input.subjectId))) throw subjectNotFound();
      const { dueAt, hasTime } = dueFromLocal(
        { date: input.dueDate, time: input.dueTime },
        actor.timezone,
      );
      try {
        const created = await activities.create({
          userId: actor.id,
          subjectId: input.subjectId,
          title: input.title,
          description: input.description ?? null,
          type: input.type,
          priority: input.priority,
          dueAt,
          hasTime,
        });
        return toActivityDto(created);
      } catch (err) {
        // The subject was deleted between the check and the insert: the foreign key says no.
        if (isPrismaError(err, 'P2003')) throw subjectNotFound();
        throw err;
      }
    },

    async update(actor: Actor, id: string, input: UpdateActivityInput) {
      const existing = await activities.findOwned(actor.id, id);
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

      try {
        const updated = await activities.update(actor.id, id, {
          ...(moving && { subjectId: input.subjectId }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(due && due),
          // status and completedAt are written together, so they can never disagree.
          ...(input.status !== undefined && {
            status: input.status,
            completedAt: resolveCompletedAt(existing, input.status, clock()),
          }),
        });
        return toActivityDto(updated);
      } catch (err) {
        if (isPrismaError(err, 'P2025')) throw activityNotFound();
        if (isPrismaError(err, 'P2003')) throw subjectNotFound();
        throw err;
      }
    },

    async remove(actor: Actor, id: string) {
      // Phase 7 will decide here what happens to the activity's reminders.
      if (!(await activities.delete(actor.id, id))) throw activityNotFound();
    },
  };
}

export type ActivityService = ReturnType<typeof createActivityService>;
