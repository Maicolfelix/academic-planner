import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { UpdatePeriodRequest, UpdateSubjectInput } from '@planner/core';
import {
  createPeriodRequest,
  createSubjectRequest,
  createSubjectsBatchRequest,
  updatePeriodRequest,
  deleteSubjectRequest,
  fetchCurrentPeriods,
  fetchCurrentSubjects,
  fetchHomePeriod,
  fetchPeriods,
  fetchSubjects,
  updateSubjectRequest,
} from '../api/academic';
import { ME_KEY } from '../auth/useAuth';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { PROGRESS_KEY } from '../insights/useInsights';
import { PROFILE_KEY } from '../profile/useProfile';
import { originLabelOf, type OriginOf } from './origin';

export const periodsKey = ['periods'] as const;
/** The HOME period (decided by the server). A key of its own: it is never derived from `periodsKey`. */
export const homePeriodKey = ['home-period'] as const;
/** ALL the current, active periods with their study (the summaries read all of them; HOME is one of them, or none). */
export const currentPeriodsKey = ['current-periods'] as const;
export const subjectsKey = (periodId: string) => ['subjects', periodId] as const;
/** Under the `subjects` prefix, so every subject mutation refreshes it too. */
export const currentSubjectsKey = ['subjects', 'current'] as const;

export function usePeriods() {
  return useQuery({ queryKey: periodsKey, queryFn: fetchPeriods, retry: false });
}

/**
 * The HOME current period, exactly as the server decides it (the general current period; else the primary active study's;
 * else none): `data` is the period, `null` when there is none, `undefined` while it loads. The web never re-implements which
 * study is the primary one and never takes "any current period" from the list.
 */
export function useHomePeriod() {
  return useQuery({ queryKey: homePeriodKey, queryFn: fetchHomePeriod, retry: false });
}

/**
 * The period every page that works with ONE period uses. Here "current" means HOME CURRENT: the same period the API's
 * singular endpoints use. (The name stays for the many callers; reading ALL the current periods is a later step.)
 */
export function useCurrentPeriod() {
  const query = useHomePeriod();
  return { ...query, period: query.data ?? undefined };
}

/** Every current, active period with its study, as the server lists them. */
export function useCurrentPeriods() {
  return useQuery({ queryKey: currentPeriodsKey, queryFn: fetchCurrentPeriods, retry: false });
}

/**
 * The label of the study an item comes from (by its period), or null when none is useful (see `originLabelOf`). A screen asks
 * once and hands the function to its lists, so the lists themselves need no data of their own.
 */
export function useOrigins(): OriginOf {
  const { data } = useCurrentPeriods();
  return useCallback(
    (periodId) => (periodId && data ? originLabelOf(data, periodId) : null),
    [data],
  );
}

/** What changes when a period is created or edited: the list, the home period (it may be this one) and the Dashboard. */
export function invalidateAfterPeriodChange(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: periodsKey }),
    qc.invalidateQueries({ queryKey: homePeriodKey }),
    qc.invalidateQueries({ queryKey: currentPeriodsKey }),
    qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  ]);
}

/**
 * The HOME period can change WITHOUT any period being touched (another study becomes the primary one, a study is archived or
 * restored), and everything that is read from the home period (Dashboard, Radar, subjects, activities, progress...) changes
 * with it: so everything cached is stale except who the user is and their profile.
 */
export function invalidateAfterHomeChange(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] !== ME_KEY[0] && q.queryKey[0] !== PROFILE_KEY[0],
  });
}

/**
 * The subjects of ALL the current, active periods, one request (to READ: the Activities list and its filter). Creating things
 * keeps using the HOME period's subjects (`useSubjects(period.id)`).
 */
export function useCurrentSubjects() {
  return useQuery({
    queryKey: [...currentSubjectsKey],
    queryFn: fetchCurrentSubjects,
    retry: false,
  });
}

export function useCreatePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPeriodRequest,
    // Returning the promise makes the mutation wait for fresh data before callers navigate.
    onSuccess: () => invalidateAfterPeriodChange(qc),
  });
}

/** Changes one period (here: its study level). Everything that shows the period is refreshed. */
export function useUpdatePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePeriodRequest }) =>
      updatePeriodRequest(id, input),
    onSuccess: () => invalidateAfterPeriodChange(qc),
  });
}

export function useSubjects(periodId: string | undefined) {
  return useQuery({
    queryKey: subjectsKey(periodId ?? ''),
    queryFn: () => fetchSubjects(periodId!),
    enabled: periodId !== undefined,
    retry: false,
  });
}

// Every subject mutation refreshes all cached subject lists and the Dashboard (its subject count and
// the subject names/colors on its rows), so the UI never needs a page reload.
function useInvalidateSubjects() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['subjects'] }),
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
      // The progress lists every subject of the period (with its name, color and counts).
      qc.invalidateQueries({ queryKey: PROGRESS_KEY }),
    ]);
}

export function useCreateSubject() {
  const invalidate = useInvalidateSubjects();
  return useMutation({ mutationFn: createSubjectRequest, onSuccess: invalidate });
}

export function useUpdateSubject() {
  const invalidate = useInvalidateSubjects();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSubjectInput }) =>
      updateSubjectRequest(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteSubject() {
  const invalidate = useInvalidateSubjects();
  return useMutation({ mutationFn: deleteSubjectRequest, onSuccess: invalidate });
}

/** The quick setup of subjects: one request for all of them; the lists, the Dashboard and the progress are refreshed. */
export function useCreateSubjectsBatch() {
  const invalidate = useInvalidateSubjects();
  return useMutation({ mutationFn: createSubjectsBatchRequest, onSuccess: () => invalidate() });
}
