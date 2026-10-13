import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdatePeriodRequest, UpdateSubjectInput } from '@planner/core';
import {
  createPeriodRequest,
  createSubjectRequest,
  createSubjectsBatchRequest,
  updatePeriodRequest,
  deleteSubjectRequest,
  fetchPeriods,
  fetchSubjects,
  updateSubjectRequest,
} from '../api/academic';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { PROGRESS_KEY } from '../insights/useInsights';

export const periodsKey = ['periods'] as const;
export const subjectsKey = (periodId: string) => ['subjects', periodId] as const;

export function usePeriods() {
  return useQuery({ queryKey: periodsKey, queryFn: fetchPeriods, retry: false });
}

/** The current period is derived from the periods query: one source of truth, no copy in state. */
export function useCurrentPeriod() {
  const query = usePeriods();
  return { ...query, period: query.data?.find((p) => p.isCurrent) };
}

export function useCreatePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPeriodRequest,
    // Returning the promise makes the mutation wait for fresh data before callers navigate.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: periodsKey }),
        qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
      ]),
  });
}

/** Changes one period (here: its study level). Everything that shows the period is refreshed. */
export function useUpdatePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePeriodRequest }) =>
      updatePeriodRequest(id, input),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: periodsKey }),
        qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
      ]),
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
