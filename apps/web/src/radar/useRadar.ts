import { useQuery } from '@tanstack/react-query';
import { fetchRadar } from '../api/radar';

export const RADAR_KEY = ['radar'] as const;

/**
 * The Radar is derived from the clock: an activity moves from one category to the next with no write at all,
 * so a cached answer goes stale by itself. It is re-read once a minute (enough: nobody needs the exact
 * millisecond a category flips) and counts as fresh for 30 s, so moving between the Dashboard and /radar does
 * not refetch. Activity mutations invalidate this key too (see useActivities).
 */
export function useRadar() {
  return useQuery({
    queryKey: RADAR_KEY,
    queryFn: fetchRadar,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}
