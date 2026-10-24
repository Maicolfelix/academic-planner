import { formatClock, type Dashboard } from '@planner/core';

/**
 * The Pixel Companion's state (V1): a small, deterministic description of the academic MOMENT, never of the person. It is
 * derived only from what the Home already has (counts of what is due), with no clock, no randomness and no stored memory. It
 * never reads grades, never judges, and nothing in it rewards: no points, streaks, levels or goals.
 *
 * CELEBRATE (a "just finished something") is deliberately NOT here: it needs a "recently completed" signal, and the Home has
 * none without inventing timestamps or adding a backend field. Showing it from the overall percentage would make it permanent.
 */
export const COMPANION_STATES = ['CALM', 'FOCUSED', 'BUSY', 'REST'] as const;
export type CompanionState = (typeof COMPANION_STATES)[number];

export interface CompanionContext {
  /** Open activities already past their deadline. */
  overdueCount: number;
  /** Open activities due today. */
  immediateCount: number;
  /** Is there an open activity coming up (the Home's "next due")? */
  nextItemExists: boolean;
  /** Does the student have any activity at all? */
  hasActivities: boolean;
}

const whole = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

/**
 * Priority, first match wins:
 *  1. BUSY    — two or more things pressing (overdue or due today).
 *  2. FOCUSED — exactly one thing pressing: one clear next step.
 *  3. CALM    — nothing pressing; either nothing registered yet, or things are planned ahead.
 *  4. REST    — nothing pressing and nothing coming up.
 * Unexpected values (negative, NaN, missing) count as zero.
 */
export function deriveCompanionState(
  ctx: Partial<CompanionContext> | null | undefined,
): CompanionState {
  const pressing = whole(ctx?.overdueCount) + whole(ctx?.immediateCount);
  if (pressing >= 2) return 'BUSY';
  if (pressing === 1) return 'FOCUSED';
  if (!ctx?.hasActivities) return 'CALM';
  return ctx.nextItemExists ? 'CALM' : 'REST';
}

/** One short line per state. Neutral: it describes the moment, it does not ask for anything. */
export const COMPANION_COPY: Record<CompanionState, string> = {
  CALM: 'Todo en orden por ahora.',
  FOCUSED: 'Una cosa a la vez.',
  BUSY: 'Hay varias cosas cerca. Vamos por partes.',
  REST: 'Hoy se ve tranquilo.',
};

const TITLE_MAX = 60;

const clip = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t;
};

/**
 * What the student has next TODAY in the timetable, in one neutral line (P9-2). It never names an activity: the "what do I do
 * now" hero is right below and says that. Only classes the Home already carries (`classesToday`) are read; a class counts until
 * it ends. With no class today at all it says nothing (the student may simply not use the timetable); once today's classes
 * are over it says so.
 */
export function companionClassLine(
  classes: readonly { title: string; startAt: string; endAt: string }[],
  now: Date,
  timeZone: string,
): string | null {
  if (classes.length === 0) return null;
  const t = now.getTime();
  const next = classes
    .filter((c) => Date.parse(c.endAt) > t)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  if (!next) return 'Hoy no quedan clases.';
  const title = clip(next.title);
  if (title === '') return null;
  return Date.parse(next.startAt) <= t
    ? `Tienes clase ahora: ${title}.`
    : `Tu próxima clase es ${title} a las ${formatClock(next.startAt, timeZone)}.`;
}

/** From the Home's own response (already normalized by the server) to the companion's input. */
export function companionFromDashboard(d: Dashboard): CompanionContext {
  return {
    overdueCount: d.summary.overdue,
    immediateCount: d.today.length,
    nextItemExists: d.nextDue !== null,
    hasActivities: d.summary.total > 0,
  };
}
