import { z } from 'zod';
import { dateOnlySchema } from './academic.js';
import {
  ACTIVITY_TYPES,
  dueTimeSchema,
  type ActivityStatus,
  type ActivityType,
} from './activity.js';
import { dueRelativeLabel } from './dashboard.js';
import { formatClock } from './time.js';

// ───────────────────────── Enums ─────────────────────────

export const REMINDER_KINDS = ['AUTO', 'MANUAL'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** PENDING (not shown yet) → SHOWN (the app displayed it) or CANCELLED (the activity was finished). */
export const REMINDER_STATUSES = ['PENDING', 'SHOWN', 'CANCELLED'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  PENDING: 'Pendiente',
  SHOWN: 'Mostrado',
  CANCELLED: 'Cancelado',
};

/** The dashboard and the nav badge never list more than this many due reminders at once. */
export const DUE_REMINDERS_LIMIT = 20;

// ───────────────────────── Automatic rules ─────────────────────────

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * Default reminders per activity type, as minutes BEFORE the deadline (always negative), earliest
 * warning first. remindAt = dueAt + offset, in absolute minutes (so "1 day before" is exactly 24 h before).
 * An activity without a time is due at the end of its local day, so its "1 day before" falls at
 * 23:59 of the previous day: acceptable for now, no other hour is invented.
 */
export const AUTO_REMINDER_OFFSETS: Record<ActivityType, readonly number[]> = {
  TASK: [-DAY, -3 * HOUR],
  EXAM: [-3 * DAY, -DAY, -3 * HOUR],
  QUIZ: [-DAY, -3 * HOUR],
  PROJECT: [-7 * DAY, -3 * DAY, -DAY],
  PRESENTATION: [-3 * DAY, -DAY],
  WORKSHOP: [-DAY, -3 * HOUR],
  READING: [-DAY],
  OTHER: [-DAY],
};

export const getDefaultReminderOffsets = (type: ActivityType): readonly number[] =>
  AUTO_REMINDER_OFFSETS[type];

type Instant = Date | string;

export interface AutoReminderTime {
  offsetMinutes: number;
  remindAt: Date;
}

/**
 * The automatic reminders that still make sense at `now`.
 *  - a reminder whose time has already passed is never created (no PENDING reminder in the past);
 *  - an activity that is already overdue, or finished, gets none.
 * Pure: the clock is injected.
 */
export function buildAutoReminderTimes(
  activity: { type: ActivityType; dueAt: Instant; status: ActivityStatus },
  now: Date,
): AutoReminderTime[] {
  const due = new Date(activity.dueAt).getTime();
  if (activity.status === 'COMPLETED' || due <= now.getTime()) return [];
  return getDefaultReminderOffsets(activity.type)
    .map((offsetMinutes) => ({ offsetMinutes, remindAt: new Date(due + offsetMinutes * 60_000) }))
    .filter((r) => r.remindAt.getTime() > now.getTime());
}

export interface ReminderRelevantState {
  type: ActivityType;
  dueAt: Instant;
  status: ActivityStatus;
}

export interface ReminderPlan {
  /** The activity was just finished: its PENDING reminders become CANCELLED. */
  cancelPending: boolean;
  /** The activity was reopened: MANUAL reminders cancelled by the completion come back if still in the future. */
  reviveManual: boolean;
  /** AUTO reminders must be recomputed from the current type and deadline. */
  regenerateAuto: boolean;
}

/**
 * What an activity change means for its reminders. ONLY three things matter: the deadline, the type, and
 * crossing the COMPLETED boundary. Title, description, priority, subject and PENDING ↔ IN_PROGRESS change
 * nothing, so an AUTO reminder the student deleted does not come back when they rename the activity.
 */
export function planReminderChange(
  prev: ReminderRelevantState,
  next: ReminderRelevantState,
): ReminderPlan {
  const wasDone = prev.status === 'COMPLETED';
  const isDone = next.status === 'COMPLETED';

  if (isDone) return { cancelPending: !wasDone, reviveManual: false, regenerateAuto: false };

  const dueChanged = new Date(prev.dueAt).getTime() !== new Date(next.dueAt).getTime();
  const typeChanged = prev.type !== next.type;
  return {
    cancelPending: false,
    reviveManual: wasDone,
    regenerateAuto: wasDone || dueChanged || typeChanged,
  };
}

// ───────────────────────── Manual reminders ─────────────────────────

export const REMINDER_IN_THE_PAST = 'El recordatorio debe ser en el futuro.';
export const REMINDER_NOT_BEFORE_DUE =
  'El recordatorio debe ser anterior a la fecha límite de la actividad.';

/** A manual reminder must lie in the future and strictly before the deadline (after it would be pointless). */
export function checkManualRemindAt(
  remindAt: Date,
  dueAt: Instant,
  now: Date,
): 'IN_THE_PAST' | 'NOT_BEFORE_DUE' | null {
  if (remindAt.getTime() <= now.getTime()) return 'IN_THE_PAST';
  if (remindAt.getTime() >= new Date(dueAt).getTime()) return 'NOT_BEFORE_DUE';
  return null;
}

// ───────────────────────── Wording (derived, never stored) ─────────────────────────

/** -1440 → "1 día antes", -180 → "3 horas antes". */
export function formatReminderOffset(offsetMinutes: number): string {
  const minutes = Math.abs(offsetMinutes);
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many} antes`;
  if (minutes % DAY === 0) return unit(minutes / DAY, 'día', 'días');
  if (minutes % HOUR === 0) return unit(minutes / HOUR, 'hora', 'horas');
  return unit(minutes, 'minuto', 'minutos');
}

/**
 * "Parcial de Redes vence mañana a las 10:00 a. m." Built from the activity at display time, so a renamed
 * or rescheduled activity is reflected without touching any reminder.
 */
export function reminderMessage(
  activity: { title: string; dueAt: Instant; hasTime: boolean },
  now: Date,
  timeZone: string,
): string {
  const relative = dueRelativeLabel(activity, now, timeZone);
  const verb = relative.charAt(0).toLowerCase() + relative.slice(1);
  const at = activity.hasTime ? ` a las ${formatClock(activity.dueAt, timeZone)}` : '';
  const text = `${activity.title} ${verb}${at}`;
  return text.endsWith('.') ? text : `${text}.`; // "a. m." already ends with a period
}

// ───────────────────────── Input schemas ─────────────────────────

const remindWhen = { remindDate: dateOnlySchema, remindTime: dueTimeSchema };

/** Owner and kind are never part of the input: the session decides the owner, and this is always MANUAL. */
export const createReminderSchema = z.strictObject({
  activityId: z.uuid('Elige una actividad.'),
  ...remindWhen,
});

/** Editing an AUTO reminder turns it into MANUAL: the student's decision must never be recomputed. */
export const updateReminderSchema = z.strictObject(remindWhen);

export const markSeenSchema = z.strictObject({
  ids: z
    .array(z.uuid('Recordatorio inválido.'))
    .min(1)
    .max(DUE_REMINDERS_LIMIT * 2),
});

export const listRemindersQuerySchema = z.object({
  activityId: z.uuid('Actividad inválida.').optional(),
  status: z.enum(REMINDER_STATUSES, { error: 'Estado inválido.' }).optional(),
});

// ───────────────────────── Response schemas ─────────────────────────

export const reminderSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid(),
  remindAt: z.iso.datetime(),
  kind: z.enum(REMINDER_KINDS),
  status: z.enum(REMINDER_STATUSES),
  offsetMinutes: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** A due reminder with just enough of its activity and subject to build the message (one query, no N+1). */
export const dueReminderSchema = reminderSchema.extend({
  activity: z.object({
    id: z.uuid(),
    title: z.string(),
    type: z.enum(ACTIVITY_TYPES),
    dueAt: z.iso.datetime(),
    hasTime: z.boolean(),
  }),
  subject: z.object({ id: z.uuid(), name: z.string(), color: z.string() }),
});

export const reminderResponseSchema = z.object({ reminder: reminderSchema });
export const reminderListResponseSchema = z.object({ reminders: z.array(reminderSchema) });
export const dueRemindersResponseSchema = z.object({
  reminders: z.array(dueReminderSchema),
  /** All due reminders, which can exceed the DUE_REMINDERS_LIMIT shown. */
  total: z.number().int().nonnegative(),
});
export const markSeenResponseSchema = z.object({ updated: z.number().int().nonnegative() });

export type Reminder = z.infer<typeof reminderSchema>;
export type DueReminder = z.infer<typeof dueReminderSchema>;
export type CreateReminderInput = z.infer<typeof createReminderSchema>;
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;
