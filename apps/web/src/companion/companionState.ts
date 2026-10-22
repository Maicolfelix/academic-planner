import type { Dashboard } from '@planner/core';

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

/** "Lo próximo es tu …" — only when exactly that one item is clearly known; never a date, so nothing can contradict a card. */
export function companionNextLine(
  state: CompanionState,
  title: string | null | undefined,
): string | null {
  if (state !== 'FOCUSED' && state !== 'CALM') return null;
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  return `Lo próximo es tu ${t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t}.`;
}

/** From the Home's own response (already normalized by the server) to the companion's input and the item it may mention. */
export function companionFromDashboard(d: Dashboard): {
  context: CompanionContext;
  title: string | null;
} {
  const context: CompanionContext = {
    overdueCount: d.summary.overdue,
    immediateCount: d.today.length,
    nextItemExists: d.nextDue !== null,
    hasActivities: d.summary.total > 0,
  };
  // The one item to name: the single pressing activity, or else the next one due.
  const single =
    context.overdueCount === 1 && context.immediateCount === 0
      ? d.overdue[0]
      : context.overdueCount === 0 && context.immediateCount === 1
        ? d.today[0]
        : undefined;
  return { context, title: (single ?? d.nextDue)?.title ?? null };
}
