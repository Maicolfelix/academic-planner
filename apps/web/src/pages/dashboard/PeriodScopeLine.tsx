import { formatDateOnly, type AcademicPeriod, type CurrentPeriodContext } from '@planner/core';
import { readsSeveralPeriods, scopeNames } from '../../academic/origin';

/**
 * The quiet line under the greeting that says WHAT the Home is reading. With one current period it is that period (name and
 * dates), exactly as it always was. With several the Home reads all of them, so the line says so and names them (a study, or a
 * general period): presenting the home period alone would be a lie. It is text, not a selector: the Home stays one screen.
 */
export function PeriodScopeLine({
  period,
  periods,
}: {
  period: AcademicPeriod | null;
  periods: readonly CurrentPeriodContext[];
}) {
  if (readsSeveralPeriods(periods)) {
    return (
      <p className="mt-0.5 text-sm text-muted-foreground break-words">
        En tus estudios actuales: {scopeNames(periods).join(' · ')}
      </p>
    );
  }
  if (!period) return null;
  return (
    <p className="mt-0.5 text-sm text-muted-foreground break-words">
      {period.name} · {formatDateOnly(period.startDate)} – {formatDateOnly(period.endDate)}
    </p>
  );
}
