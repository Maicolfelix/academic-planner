import { useQuery } from '@tanstack/react-query';
import { fetchDashboard } from '../api/dashboard';

export const DASHBOARD_KEY = ['dashboard'] as const;

/**
 * The whole Dashboard in one request. It is derived data, so it is never edited locally: any mutation
 * that can change it invalidates this key (see useActivities / useAcademic), and coming back to the
 * page always shows fresh numbers without a manual refresh.
 */
export function useDashboard() {
  return useQuery({ queryKey: DASHBOARD_KEY, queryFn: fetchDashboard, retry: false });
}
