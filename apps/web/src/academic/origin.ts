import type { CurrentPeriodContext } from '@planner/core';

/** Finds the label of the study of a period (see `originLabelOf`); null when there is none worth showing. */
export type OriginOf = (periodId: string | undefined) => string | null;

/**
 * Where something comes from, as a short label: the NAME of its study. Shown only when it tells the student something: when
 * at least TWO different studies have a current period (with one study, or only a general period, every item would carry the
 * same label, so none is shown). A general period (no study) never gets a label ("Sin estudio" would only be noise), and a
 * period that is not among the current ones (a past one) has none either. The label is text, never a color on its own.
 */
export function originLabelOf(
  contexts: readonly CurrentPeriodContext[],
  periodId: string,
): string | null {
  const studies = new Set(contexts.flatMap((c) => (c.studyTrack ? [c.studyTrack.id] : [])));
  if (studies.size < 2) return null;
  return contexts.find((c) => c.period.id === periodId)?.studyTrack?.name ?? null;
}

/** True when a summary reads more than one period: its copy must not say "this period". */
export const readsSeveralPeriods = (contexts: readonly unknown[]): boolean => contexts.length > 1;

/** The names of what a summary reads, in order: a study's name, or the name of a general period. */
export const scopeNames = (contexts: readonly CurrentPeriodContext[]): string[] =>
  contexts.map((c) => c.studyTrack?.name ?? c.period.name);
