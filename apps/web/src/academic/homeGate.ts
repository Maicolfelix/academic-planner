import type { AcademicPeriod } from '@planner/core';

export type HomeGate = 'LOADING' | 'ERROR' | 'ENTER' | 'ONBOARD';

/**
 * What `RequirePeriod` does, from the state of the HOME period query. The app can be used only when there IS a home period
 * (`data` is the period); `null` (none) sends the user to the onboarding even if some other study has a current period.
 */
export function homeGate(q: {
  isPending: boolean;
  isError: boolean;
  data: AcademicPeriod | null | undefined;
}): HomeGate {
  if (q.isPending) return 'LOADING';
  if (q.isError && q.data === undefined) return 'ERROR';
  return q.data ? 'ENTER' : 'ONBOARD';
}
