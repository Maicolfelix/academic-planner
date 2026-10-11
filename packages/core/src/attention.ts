import { z } from 'zod';
import { periodSchema } from './academic.js';
import {
  RADAR_STATUSES,
  type ActivityPriority,
  type ActivityStatus,
  type RadarStatus,
} from './activity.js';
import { dueRelativeLabel } from './dashboard.js';
import { calculateRadarStatus, radarActivitySchema } from './radar.js';

/**
 * "¿QUÉ HAGO AHORA?": a deterministic, explainable ranking of the open activities that deserve attention.
 *
 *   score = tier weight (from the Radar) + priority weight + in-progress bonus
 *
 * It uses ONLY the Radar category, the priority, the status and (as a tie-break) the exact deadline. No AI, no
 * history, no hidden variables. It never says "you must": it orients, the student decides. The score is an
 * internal detail: the UI shows the human reasons, never the number. Nothing is stored; every call recomputes.
 * See docs/attention-engine.md for the analysis behind these weights.
 */

const DAY_MS = 86_400_000;

/**
 * An activity overdue for MORE than this keeps being a candidate but stops dominating: otherwise something
 * forgotten for months would top every recommendation forever. Strict: exactly 7 days is still recent.
 */
export const ATTENTION_STALE_OVERDUE_MS = 7 * DAY_MS;

/** The Radar category, with OVERDUE split in two by age so the oldest cannot dominate eternally. */
export type AttentionTier = RadarStatus | 'OVERDUE_STALE';

/**
 * Tier weights. Two properties are deliberate (and checked by a test):
 *  1. consecutive tiers are 10 apart, which is MORE than the largest possible priority + status boost (9), so a
 *     more urgent tier ALWAYS wins and priority/status only order activities inside the same tier;
 *  2. a finite OVERDUE (60) is the highest tier, but an overdue-for-more-than-a-week activity (20) ranks below
 *     everything due within 7 days and above only the ones due in more than a week.
 */
export const ATTENTION_TIER_WEIGHTS: Record<AttentionTier, number> = {
  OVERDUE: 60,
  IMMEDIATE: 50,
  UPCOMING: 40,
  PLANNABLE: 30,
  OVERDUE_STALE: 20,
  UNDER_CONTROL: 10,
};

/** Priority matters inside a tier but can never make up for a whole tier (see the 10-point rule above). */
export const ATTENTION_PRIORITY_WEIGHTS: Record<ActivityPriority, number> = {
  HIGH: 9,
  MEDIUM: 5,
  LOW: 1,
};

/** Small on purpose: smaller than any priority step (4), so "already started" breaks ties but never outranks priority. */
export const ATTENTION_IN_PROGRESS_BONUS = 1;

/** Candidates returned by the endpoint: the recommendation plus this many alternatives. */
export const ATTENTION_ALTERNATIVES_LIMIT = 2;

/**
 * How many activities the Home hero lets the student walk through, nearest deadline first. Five: enough to see the week
 * ahead without turning the hero into a list (the rest is in "Próximas entregas" and Activities), and few enough that its
 * dots stay a control one can tap, not a scale.
 */
export const HERO_MAX_ACTIVITIES = 5;

/** The activity fields the engine reads. */
export interface AttentionInput {
  id: string;
  dueAt: Date | string;
  status: ActivityStatus;
  priority: ActivityPriority;
  createdAt: Date | string;
}

export interface AttentionCandidate<T extends AttentionInput = AttentionInput> {
  activity: T;
  /** Internal. Never shown to the student. */
  score: number;
  radarStatus: RadarStatus;
}

const time = (d: Date | string) => new Date(d).getTime();

/** The tier of an open activity, or null when it is finished (it never takes part). */
export function attentionTier(
  activity: Pick<AttentionInput, 'dueAt' | 'status'>,
  now: Date,
): AttentionTier | null {
  const radar = calculateRadarStatus(activity, now);
  if (radar === 'OVERDUE' && now.getTime() - time(activity.dueAt) > ATTENTION_STALE_OVERDUE_MS) {
    return 'OVERDUE_STALE';
  }
  return radar;
}

/** null for a COMPLETED activity. */
export function calculateAttentionScore(
  activity: Pick<AttentionInput, 'dueAt' | 'status' | 'priority'>,
  now: Date,
): number | null {
  const tier = attentionTier(activity, now);
  if (tier === null) return null;
  return (
    ATTENTION_TIER_WEIGHTS[tier] +
    ATTENTION_PRIORITY_WEIGHTS[activity.priority] +
    (activity.status === 'IN_PROGRESS' ? ATTENTION_IN_PROGRESS_BONUS : 0)
  );
}

/**
 * Total order, never left to the database:
 *   1. higher score  2. earlier deadline  3. IN_PROGRESS before PENDING  4. higher priority
 *   5. older creation  6. id (a stable last resort).
 * With the current weights steps 3 and 4 are already part of the score, so they only decide when the score
 * is forced to tie; they stay so the rule remains complete if a weight is ever changed.
 */
export function compareAttentionCandidates(a: AttentionCandidate, b: AttentionCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  const dueDiff = time(a.activity.dueAt) - time(b.activity.dueAt);
  if (dueDiff !== 0) return dueDiff;
  const inProgress = (c: AttentionCandidate) => (c.activity.status === 'IN_PROGRESS' ? 0 : 1);
  if (inProgress(a) !== inProgress(b)) return inProgress(a) - inProgress(b);
  const priorityDiff =
    ATTENTION_PRIORITY_WEIGHTS[b.activity.priority] -
    ATTENTION_PRIORITY_WEIGHTS[a.activity.priority];
  if (priorityDiff !== 0) return priorityDiff;
  const createdDiff = time(a.activity.createdAt) - time(b.activity.createdAt);
  if (createdDiff !== 0) return createdDiff;
  return a.activity.id < b.activity.id ? -1 : a.activity.id > b.activity.id ? 1 : 0;
}

/** Open activities, most deserving of attention first. COMPLETED ones are dropped. Pure and deterministic. */
export function rankActivitiesForAttention<T extends AttentionInput>(
  activities: readonly T[],
  now: Date,
): AttentionCandidate<T>[] {
  const candidates: AttentionCandidate<T>[] = [];
  for (const activity of activities) {
    const score = calculateAttentionScore(activity, now);
    const radarStatus = calculateRadarStatus(activity, now);
    if (score === null || radarStatus === null) continue;
    candidates.push({ activity, score, radarStatus });
  }
  return candidates.sort(compareAttentionCandidates);
}

/**
 * The activities the Home hero walks through: open ones, soonest deadline first (an overdue one that is still recent is
 * the soonest of all). One forgotten for more than a week is left out: it must not be the first thing every day. At most
 * HERO_MAX_ACTIVITIES. Ties: the older one, then the id, so the order is always the same. Pure and deterministic.
 */
export function nearestDeadlines<T extends AttentionInput>(
  activities: readonly T[],
  now: Date,
): AttentionCandidate<T>[] {
  return rankActivitiesForAttention(activities, now)
    .filter((c) => attentionTier(c.activity, now) !== 'OVERDUE_STALE')
    .sort((a, b) => {
      const due = time(a.activity.dueAt) - time(b.activity.dueAt);
      if (due !== 0) return due;
      const created = time(a.activity.createdAt) - time(b.activity.createdAt);
      if (created !== 0) return created;
      return a.activity.id < b.activity.id ? -1 : a.activity.id > b.activity.id ? 1 : 0;
    })
    .slice(0, HERO_MAX_ACTIVITIES);
}

/** Fixed templates, one per Radar category. */
export const ATTENTION_RADAR_REASONS: Record<RadarStatus, string> = {
  OVERDUE: 'Esta actividad ya está vencida.',
  IMMEDIATE: 'Vence en menos de 24 horas.',
  UPCOMING: 'Vence en los próximos 3 días.',
  PLANNABLE: 'Vence durante esta semana.',
  UNDER_CONTROL: 'La fecha límite aún está a más de una semana.',
};
export const ATTENTION_HIGH_PRIORITY_REASON = 'Tiene prioridad alta.';
export const ATTENTION_IN_PROGRESS_REASON = 'Ya comenzaste esta actividad.';

/**
 * The human "why", from deterministic templates (never generated text). Medium and low priority are not
 * reasons. For an overdue activity the first reason stays "ya está vencida" and the app's usual wording
 * ("Venció hace 3 días.") follows. `timeZone` only affects that calendar wording.
 */
export function buildAttentionReasons(
  activity: Pick<AttentionInput, 'dueAt' | 'status' | 'priority'>,
  now: Date,
  timeZone: string,
): string[] {
  const radar = calculateRadarStatus(activity, now);
  if (radar === null) return [];
  const reasons = [ATTENTION_RADAR_REASONS[radar]];
  if (radar === 'OVERDUE') reasons.push(`${dueRelativeLabel(activity, now, timeZone)}.`);
  if (activity.priority === 'HIGH') reasons.push(ATTENTION_HIGH_PRIORITY_REASON);
  if (activity.status === 'IN_PROGRESS') reasons.push(ATTENTION_IN_PROGRESS_REASON);
  return reasons;
}

// ───────────────────────── Response ─────────────────────────

const attentionItemSchema = z.object({
  activity: radarActivitySchema,
  radarStatus: z.enum(RADAR_STATUSES),
  /** Why this one, in plain words. The internal score is deliberately not part of the response. */
  reasons: z.array(z.string()),
});

/**
 * GET /api/attention: the open activity of the CURRENT period that deserves the most attention right now, and up
 * to ATTENTION_ALTERNATIVES_LIMIT more. `recommendation` is null when nothing is open. Derived on every call.
 */
export const attentionSchema = z.object({
  generatedAt: z.iso.datetime(),
  /** null when the user has not set up a period yet. */
  period: periodSchema.nullable(),
  recommendation: attentionItemSchema.nullable(),
  alternatives: z.array(attentionItemSchema).max(ATTENTION_ALTERNATIVES_LIMIT),
  /**
   * The Home hero's activities, nearest deadline first (at most HERO_MAX_ACTIVITIES; empty when only forgotten ones are
   * open, and then the hero falls back to `recommendation`).
   */
  upcoming: z.array(attentionItemSchema).max(HERO_MAX_ACTIVITIES),
});

export const attentionResponseSchema = z.object({ attention: attentionSchema });

export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type Attention = z.infer<typeof attentionSchema>;
