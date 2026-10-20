import { formatScore, formatUnitsPercent, type GradeContext } from '@planner/core';

/** What a linked activity weighs in the final grade, in words (information only: the Radar never orders by it). */
export function gradeContextText(context: GradeContext): string {
  const { evaluations, totalFinalWeightUnits, decimals } = context;
  if (evaluations.length > 1) {
    return `${evaluations.length} evaluaciones · ${formatUnitsPercent(totalFinalWeightUnits)} de la nota final`;
  }
  const e = evaluations[0]!;
  const weight = formatUnitsPercent(e.finalWeightUnits);
  // A direct grade of a whole cut has no name of its own: the cut says it.
  const head = [e.isCutGrade ? null : e.name, e.cutName].filter(Boolean).join(' · ');
  return e.scoreMilli === null
    ? `${head} · ${weight} de la nota final`
    : `${head} · ${weight} · Nota ${formatScore(e.scoreMilli, decimals)}`;
}

/** One quiet line under an activity of the Radar; nothing at all when the activity has no linked evaluation. */
export function GradeContextLine({ context }: { context?: GradeContext }) {
  if (!context) return null;
  return <p className="text-sm break-words text-muted-foreground">{gradeContextText(context)}</p>;
}
