import { z } from 'zod';
import { periodSchema } from './academic.js';
import { activitySchema } from './activity.js';
import { scheduleOccurrenceSchema } from './schedule.js';
import { toLocalParts } from './time.js';

export const DASHBOARD_UPCOMING_LIMIT = 5;
export const DASHBOARD_OVERDUE_LIMIT = 10;
export const DASHBOARD_CLASSES_LIMIT = 5;

// ───────────────────────── Pure rules ─────────────────────────

/**
 * Share of registered activities that are finished, as a whole percent. It measures tasks only: it is
 * not performance, grades or knowledge.
 *  - no activities -> 0
 *  - rounded to the nearest integer (1/3 -> 33, 2/3 -> 67, 18/25 -> 72)
 *  - never overstates: 100 only when EVERYTHING is finished (199/200 shows 99, not 100), and
 *    0 only when nothing is finished (1/300 shows 1, not 0).
 */
export function calculateProgress(completed: number, total: number): number {
  if (total <= 0 || completed <= 0) return 0;
  if (completed >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((completed / total) * 100)));
}

/**
 * The one place the greeting rule lives: 05:00–11:59 morning, 12:00–18:59 afternoon, otherwise night,
 * read on the USER's wall clock (their profile timezone), never the device's. The backend runs it and
 * ships the text; the frontend only displays it.
 */
export function greetingForTime(now: Date, timeZone: string): string {
  const hour = Number(toLocalParts(now, timeZone).time.slice(0, 2));
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const DAY_MS = 86_400_000;

/**
 * Whole calendar days from `now` to `instant` on the user's wall clock: 0 = same local day,
 * 1 = tomorrow, -1 = yesterday. Compares LOCAL dates, so 23:59 and 00:01 are different days
 * even though they are two minutes apart, and the UTC date is irrelevant.
 */
export function localDayDiff(instant: Date | string, now: Date, timeZone: string): number {
  const toDayNumber = (d: Date | string) =>
    Date.parse(`${toLocalParts(d, timeZone).date}T00:00:00Z`) / DAY_MS;
  return Math.round(toDayNumber(instant) - toDayNumber(now));
}

/** Short relative wording for a deadline ("Vence hoy", "Vence mañana", "Vence en 3 días", "Venció hace 2 días"). */
export function dueRelativeLabel(
  due: { dueAt: Date | string },
  now: Date,
  timeZone: string,
): string {
  const days = localDayDiff(due.dueAt, now, timeZone);
  const passed = new Date(due.dueAt).getTime() < now.getTime();

  if (passed) {
    if (days >= 0) return 'Venció hoy';
    if (days === -1) return 'Venció ayer';
    return `Venció hace ${-days} días`;
  }
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days} días`;
}

// ───────────────────────── Response ─────────────────────────

export const dashboardActivitySchema = activitySchema.extend({
  subject: z.object({ id: z.uuid(), name: z.string(), color: z.string() }),
});

const count = z.number().int().nonnegative();

/**
 * Everything the Dashboard needs, for the CURRENT period of the authenticated user. Nothing here is
 * stored: every number is derived from User, AcademicPeriod, Subject and Activity on each request.
 * The three lists never overlap: an activity is overdue, due today, or upcoming — never two at once.
 */
export const dashboardSchema = z.object({
  generatedAt: z.iso.datetime(),
  /** Today's date on the user's wall clock (YYYY-MM-DD). */
  localDate: z.string(),
  greeting: z.string(),
  /** null when the user has not set up a period yet (the app sends them to onboarding). */
  period: periodSchema.nullable(),
  subjectCount: count,
  summary: z.object({
    total: count,
    pending: count,
    inProgress: count,
    completed: count,
    /** Open activities past their deadline (can exceed the length of `overdue`, which is capped). */
    overdue: count,
  }),
  progress: z.object({ completed: count, total: count, percent: z.number().int().min(0).max(100) }),
  /** The first open, not-yet-due activity by deadline (from `today` or `upcoming`). Date only, no scoring. */
  nextDue: dashboardActivitySchema.nullable(),
  /** Open, not overdue, due on the user's local today. */
  today: z.array(dashboardActivitySchema),
  /** Open, due after today, soonest first, at most DASHBOARD_UPCOMING_LIMIT. */
  upcoming: z.array(dashboardActivitySchema),
  /** Open and past due, most overdue first, at most DASHBOARD_OVERDUE_LIMIT. */
  overdue: z.array(dashboardActivitySchema),
  /** Today's classes (type CLASS only) of the current period, by start time, at most DASHBOARD_CLASSES_LIMIT. */
  classesToday: z.array(scheduleOccurrenceSchema),
});

export const dashboardResponseSchema = z.object({ dashboard: dashboardSchema });

export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
