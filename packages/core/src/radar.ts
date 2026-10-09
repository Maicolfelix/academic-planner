import { z } from 'zod';
import { activitySchema, type ActivityStatus, type RadarStatus } from './activity.js';
import { dueRelativeLabel } from './dashboard.js';
import { periodSchema } from './academic.js';

/**
 * ACADEMIC RADAR: a deterministic reading of "how much time is left" for an open activity.
 *
 * It only looks at the deadline, the status and the current instant. It is NOT priority, NOT a score and
 * NOT a recommendation of what to do first (that is a later phase). It is derived on every read and never
 * stored: the category changes by itself as time passes, with no job and no write.
 *
 * Thresholds are REAL durations (`dueAt - now`, absolute instants), not calendar days, so the category does
 * not depend on any timezone: 23 h left is IMMEDIATE even if the date reads "tomorrow".
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Documented limits (see docs/radar.md). Remaining time at each limit belongs to the LOWER-urgency side noted below. */
export const RADAR_IMMEDIATE_MS = DAY_MS; //          < 24 h              -> IMMEDIATE (24 h exactly is UPCOMING)
export const RADAR_UPCOMING_MS = 3 * DAY_MS; //       24 h .. 72 h incl.  -> UPCOMING
export const RADAR_PLANNABLE_MS = 7 * DAY_MS; //      > 72 h .. 7 d incl. -> PLANNABLE; > 7 d -> UNDER_CONTROL

export const RADAR_LABELS: Record<RadarStatus, string> = {
  OVERDUE: 'Vencida',
  IMMEDIATE: 'Atención inmediata',
  UPCOMING: 'Próxima',
  PLANNABLE: 'Planificable',
  UNDER_CONTROL: 'Bajo control',
};

/** Label of the whole group ("Vencidas", "Próximas"…). */
export const RADAR_GROUP_LABELS: Record<RadarStatus, string> = {
  OVERDUE: 'Vencidas',
  IMMEDIATE: 'Atención inmediata',
  UPCOMING: 'Próximas',
  PLANNABLE: 'Planificables',
  UNDER_CONTROL: 'Bajo control',
};

/** Decorative marker; the text label always travels with it, so meaning never depends on color. */
export const RADAR_SYMBOLS: Record<RadarStatus, string> = {
  OVERDUE: '🔴',
  IMMEDIATE: '🔴',
  UPCOMING: '🟠',
  PLANNABLE: '🟡',
  UNDER_CONTROL: '🟢',
};

/** Key of each status inside `summary` and `groups` of the Radar response. */
export const RADAR_KEYS = {
  OVERDUE: 'overdue',
  IMMEDIATE: 'immediate',
  UPCOMING: 'upcoming',
  PLANNABLE: 'plannable',
  UNDER_CONTROL: 'underControl',
} as const satisfies Record<RadarStatus, string>;

/** Maximum activities listed per group in GET /api/radar (the summary always carries the real counts). */
export const RADAR_GROUP_LIMIT = 10;

// ───────────────────────── Pure rules ─────────────────────────

/**
 * The one place the rule lives. `null` for a COMPLETED activity: a finished one needs no attention.
 *
 *   remaining = dueAt - now
 *   remaining <  0            -> OVERDUE        (strict, same as `isOverdue`)
 *   0 <= remaining <  24 h    -> IMMEDIATE      (exactly at the deadline it is not overdue yet)
 *   24 h <= remaining <= 72 h -> UPCOMING
 *   72 h <  remaining <= 7 d  -> PLANNABLE
 *   remaining > 7 d           -> UNDER_CONTROL
 *
 * There is no gap and no overlap: every instant maps to exactly one status.
 */
export function calculateRadarStatus(
  activity: { dueAt: Date | string; status: ActivityStatus },
  now: Date,
): RadarStatus | null {
  if (activity.status === 'COMPLETED') return null;
  const remaining = new Date(activity.dueAt).getTime() - now.getTime();
  if (remaining < 0) return 'OVERDUE';
  if (remaining < RADAR_IMMEDIATE_MS) return 'IMMEDIATE';
  if (remaining <= RADAR_UPCOMING_MS) return 'UPCOMING';
  if (remaining <= RADAR_PLANNABLE_MS) return 'PLANNABLE';
  return 'UNDER_CONTROL';
}

/** Range of `dueAt` (Prisma-compatible operators) that selects each status among OPEN activities. */
export interface DueRange {
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
}

/**
 * The same rule seen from the database: which `dueAt` values fall in each status. The backend filters with
 * this so it never loads everything to classify it in the client. It must agree with `calculateRadarStatus`
 * at every boundary (a core test checks both around each limit).
 */
export function radarDueRange(status: RadarStatus, now: Date): DueRange {
  const at = (ms: number) => new Date(now.getTime() + ms);
  switch (status) {
    case 'OVERDUE':
      return { lt: now };
    case 'IMMEDIATE':
      return { gte: now, lt: at(RADAR_IMMEDIATE_MS) };
    case 'UPCOMING':
      return { gte: at(RADAR_IMMEDIATE_MS), lte: at(RADAR_UPCOMING_MS) };
    case 'PLANNABLE':
      return { gt: at(RADAR_UPCOMING_MS), lte: at(RADAR_PLANNABLE_MS) };
    case 'UNDER_CONTROL':
      return { gt: at(RADAR_PLANNABLE_MS) };
  }
}

/** "Vence en 5 horas", "Vence en 35 minutos" — real time left, used only inside the last 24 hours. */
function remainingLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'Vence ahora';
  const hours = Math.floor(remainingMs / HOUR_MS);
  if (hours >= 1) return `Vence en ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes >= 1) return `Vence en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  return 'Vence en menos de un minuto';
}

/**
 * Short human text for the Radar. The CATEGORY is decided by real duration and never varies with the
 * timezone; only this wording may. Inside the last 24 hours it states the time left ("Vence en 5 horas"),
 * because "hoy / mañana" would contradict the category (23 h left can read "mañana"). Everywhere else it
 * reuses the app's usual calendar wording (`dueRelativeLabel`), so a card never says two different things.
 * Completed activities have no Radar text (empty string).
 */
export function radarExplanation(
  activity: { dueAt: Date | string; status: ActivityStatus },
  now: Date,
  timeZone: string,
): string {
  const status = calculateRadarStatus(activity, now);
  if (status === null) return '';
  if (status === 'IMMEDIATE') {
    return remainingLabel(new Date(activity.dueAt).getTime() - now.getTime());
  }
  return dueRelativeLabel(activity, now, timeZone);
}

// ───────────────────────── Response ─────────────────────────

const count = z.number().int().nonnegative();

export const radarActivitySchema = activitySchema.extend({
  /** null for a general activity (no subject). */
  subject: z.object({ id: z.uuid(), name: z.string(), color: z.string() }).nullable(),
});

const perStatus = <T extends z.ZodType>(shape: T) =>
  z.object({
    overdue: shape,
    immediate: shape,
    upcoming: shape,
    plannable: shape,
    underControl: shape,
  });

/**
 * GET /api/radar: OPEN activities of the user's CURRENT period only. `summary` has the real counts; each group
 * lists at most RADAR_GROUP_LIMIT activities, soonest deadline first (for OVERDUE that means the most overdue
 * first, like the Dashboard). Nothing in it is stored.
 */
export const radarSchema = z.object({
  generatedAt: z.iso.datetime(),
  /** null when the user has not set up a period yet. */
  period: periodSchema.nullable(),
  summary: perStatus(count),
  groups: perStatus(z.array(radarActivitySchema)),
});

export const radarResponseSchema = z.object({ radar: radarSchema });

export type RadarActivity = z.infer<typeof radarActivitySchema>;
export type Radar = z.infer<typeof radarSchema>;
