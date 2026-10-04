import {
  buildAutoReminderTimes,
  planReminderChange,
  type ActivityStatus,
  type ActivityType,
} from '@planner/core';
import type { ReminderRepository } from '../repositories/reminderRepository.js';

interface ActivityState {
  id: string;
  userId: string;
  type: ActivityType;
  dueAt: Date;
  status: ActivityStatus;
}

/** A new activity starts with the automatic reminders that still make sense. */
export async function createRemindersFor(
  reminders: ReminderRepository,
  activity: ActivityState,
  now: Date,
) {
  await reminders.createAuto(activity.userId, activity.id, buildAutoReminderTimes(activity, now));
}

/**
 * Brings an activity's reminders in line after it changed. MUST run in the same transaction as the update
 * (and after taking the activity lock), so a failure here rolls the activity change back and nothing is left
 * half-done. What changes is decided by the pure `planReminderChange`: only the deadline, the type and
 * crossing COMPLETED matter. MANUAL reminders are never recomputed.
 */
export async function syncRemindersAfterChange(
  reminders: ReminderRepository,
  previous: ActivityState,
  next: ActivityState,
  now: Date,
) {
  const plan = planReminderChange(previous, next);
  if (plan.cancelPending) await reminders.cancelPending(next.id);
  if (plan.reviveManual) await reminders.reviveManual(next.id, now);
  if (plan.regenerateAuto) {
    // Replace, don't patch: obsolete AUTO rows go, the ones that still apply are created fresh.
    await reminders.deleteAuto(next.id);
    await createRemindersFor(reminders, next, now);
  }
}
