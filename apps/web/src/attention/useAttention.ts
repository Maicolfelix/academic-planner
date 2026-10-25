import type { Attention } from '@planner/core';
import { useQuery } from '@tanstack/react-query';
import { fetchAttention } from '../api/attention';

export const ATTENTION_KEY = ['attention'] as const;

/**
 * "¿Qué hago ahora?" depends on the clock as well as on the data: with no write at all, an activity can cross
 * into a more urgent Radar category and take the first place. Same strategy as the Radar: re-read once a minute
 * (never every second) and treat the answer as fresh for 30 s. Activity mutations invalidate this key
 * (see useActivities); reminders do not influence it.
 */
export function useAttention() {
  return useQuery({
    queryKey: ATTENTION_KEY,
    queryFn: fetchAttention,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * The activities the Home hero carries, in its order: the next ones by deadline (the API's `upcoming`) or, when only
 * forgotten overdue ones remain, the engine's recommendation. ONE definition for the hero and for the lists around it, so
 * the Home never shows under the hero what the hero already says.
 */
export function heroItemsOf(data: Attention | undefined) {
  if (!data) return [];
  return data.upcoming.length ? data.upcoming : data.recommendation ? [data.recommendation] : [];
}
