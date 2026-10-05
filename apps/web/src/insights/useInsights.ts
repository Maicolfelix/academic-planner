import { useQuery } from '@tanstack/react-query';
import { fetchProgress, fetchWorkload } from '../api/insights';

export const PROGRESS_KEY = ['progress'] as const;
/** Prefix of every workload query (`['workload', week]`): invalidating it refreshes any week on screen. */
export const WORKLOAD_KEY = ['workload'] as const;

/**
 * Registered-activity progress of the current period. It only changes when the student writes something, so there
 * is no polling: activity and subject mutations invalidate this key (see useActivities / useAcademic).
 */
export function useProgress() {
  return useQuery({ queryKey: PROGRESS_KEY, queryFn: fetchProgress, retry: false });
}

/**
 * Commitments of one week. `week` is any date of it; undefined = the current local week. No polling either:
 * activity and agenda mutations invalidate `['workload']`.
 */
export function useWorkload(week?: string) {
  return useQuery({
    queryKey: [...WORKLOAD_KEY, week ?? 'current'],
    queryFn: () => fetchWorkload(week),
    retry: false,
  });
}
