import {
  DUE_REMINDERS_LIMIT,
  REMINDER_IN_THE_PAST,
  REMINDER_NOT_BEFORE_DUE,
  checkManualRemindAt,
  dueFromLocal,
  type CreateReminderInput,
  type UpdateReminderInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError, notFound, validationError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toDueReminderDto, toReminderDto } from '../mappers.js';
import {
  createActivityRepository,
  type ActivityRepository,
} from '../repositories/activityRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import {
  createReminderRepository,
  type ReminderListFilter,
  type ReminderRepository,
} from '../repositories/reminderRepository.js';
import type { Actor } from './activityService.js';

const reminderNotFound = () => notFound('Recordatorio no encontrado.');
const activityNotFound = () => notFound('Actividad no encontrada.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const activityCompleted = () =>
  new AppError(409, 'ACTIVITY_COMPLETED', 'La actividad está finalizada: no admite recordatorios.');

const LIST_LIMIT = 200;

export function createReminderService(
  reminders: ReminderRepository,
  activities: ActivityRepository,
  periods: PeriodRepository,
  runInTransaction: RunInTransaction,
  /** Injected so "due" and "in the future" are testable; production passes the real clock. */
  clock: () => Date,
) {
  /** A manual reminder lies in the future and strictly before the deadline: otherwise it is pointless. */
  function remindAtFor(
    actor: Actor,
    input: { remindDate: string; remindTime: string },
    dueAt: Date,
    now: Date,
  ) {
    const { dueAt: remindAt } = dueFromLocal(
      { date: input.remindDate, time: input.remindTime },
      actor.timezone,
    );
    const problem = checkManualRemindAt(remindAt, dueAt, now);
    if (problem === 'IN_THE_PAST') throw validationError({ remindTime: [REMINDER_IN_THE_PAST] });
    if (problem === 'NOT_BEFORE_DUE')
      throw validationError({ remindTime: [REMINDER_NOT_BEFORE_DUE] });
    return remindAt;
  }

  return {
    async list(actor: Actor, filter: ReminderListFilter) {
      return (await reminders.list(actor.id, filter, LIST_LIMIT)).map(toReminderDto);
    },

    /**
     * Reminders ready to be shown: PENDING, `remindAt <= now`, activity not finished and in the user's CURRENT
     * period (the Dashboard's scope). Oldest first, at most DUE_REMINDERS_LIMIT, with the real total.
     * Reading never changes anything: a reminder only becomes SHOWN when the client confirms it displayed it.
     */
    async due(actor: Actor) {
      const period = await periods.findCurrent(actor.id);
      if (!period) return { reminders: [], total: 0 };
      const now = clock();
      const [rows, total] = await Promise.all([
        reminders.listDue(actor.id, period.id, now, DUE_REMINDERS_LIMIT),
        reminders.countDue(actor.id, period.id, now),
      ]);
      return { reminders: rows.map(toDueReminderDto), total };
    },

    /** The activity must be the user's own (foreign or unknown: the same 404) and not finished. */
    async create(actor: Actor, input: CreateReminderInput) {
      try {
        const created = await runInTransaction(async (tx) => {
          const txActivities = createActivityRepository(tx);
          // Same lock as an activity edit: a reminder cannot slip in while the activity is being finished.
          if (!(await txActivities.lock(actor.id, input.activityId))) throw activityNotFound();
          const activity = await txActivities.findOwned(actor.id, input.activityId);
          if (!activity) throw activityNotFound();
          if (activity.status === 'COMPLETED') throw activityCompleted();

          const remindAt = remindAtFor(actor, input, activity.dueAt, clock());
          return createReminderRepository(tx).createManual({
            userId: actor.id,
            activityId: activity.id,
            remindAt,
          });
        });
        return toReminderDto(created);
      } catch (err) {
        if (isPrismaError(err, 'P2003')) throw activityNotFound();
        throw err;
      }
    },

    /** Editing turns an AUTO reminder into MANUAL (so it is never recomputed over the student's choice). */
    async update(actor: Actor, id: string, input: UpdateReminderInput) {
      try {
        const updated = await runInTransaction(async (tx) => {
          const txReminders = createReminderRepository(tx);
          const txActivities = createActivityRepository(tx);

          const reminder = await txReminders.findOwned(actor.id, id);
          if (!reminder) throw reminderNotFound();
          if (!(await txActivities.lock(actor.id, reminder.activityId))) throw reminderNotFound();
          const activity = await txActivities.findOwned(actor.id, reminder.activityId);
          if (!activity) throw reminderNotFound();
          if (activity.status === 'COMPLETED') throw activityCompleted();

          const remindAt = remindAtFor(actor, input, activity.dueAt, clock());
          return txReminders.rewrite(actor.id, id, remindAt);
        });
        return toReminderDto(updated);
      } catch (err) {
        if (isPrismaError(err, 'P2025')) throw reminderNotFound();
        throw err;
      }
    },

    async remove(actor: Actor, id: string) {
      if (!(await reminders.delete(actor.id, id))) throw reminderNotFound();
    },

    /**
     * Marks due reminders as SHOWN. All or nothing: if ANY id is not the user's (or does not exist) the whole
     * request answers 404 and nothing changes, so it cannot be used to probe other users' ids. Idempotent:
     * ids that are already SHOWN/CANCELLED, or not due yet, are left as they are.
     */
    async markShown(actor: Actor, ids: string[]) {
      const unique = [...new Set(ids)];
      return runInTransaction(async (tx) => {
        const txReminders = createReminderRepository(tx);
        if ((await txReminders.countOwned(actor.id, unique)) !== unique.length)
          throw reminderNotFound();
        return { updated: await txReminders.markShown(actor.id, unique, clock()) };
      });
    },
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;
