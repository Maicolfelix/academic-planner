import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateSubjectInput } from '@planner/core';
import {
  createPeriodRequest,
  createSubjectRequest,
  deleteSubjectRequest,
  fetchPeriods,
  fetchSubjects,
  updateSubjectRequest,
} from '../api/academic';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: periodsKey }),
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

// Every subject mutation refreshes all cached subject lists, so the UI never needs a page reload.
function useInvalidateSubjects() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['subjects'] });
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
