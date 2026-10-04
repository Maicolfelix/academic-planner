import type { CreateScheduleBlockRequest, UpdateScheduleBlockRequest } from '@planner/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteScheduleBlock,
  fetchSchedule,
  fetchScheduleBlock,
  saveScheduleBlock,
} from '../api/schedule';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';

/** One query per visible range: ['schedule', from, to]. */
export function useSchedule(from: string, to: string) {
  return useQuery({
    queryKey: ['schedule', from, to],
    queryFn: () => fetchSchedule(from, to),
    retry: false,
  });
}

export function useScheduleBlock(id: string | undefined) {
  return useQuery({
    queryKey: ['schedule', 'block', id],
    queryFn: () => fetchScheduleBlock(id!),
    enabled: id !== undefined,
    retry: false,
  });
}

// Every write refreshes every cached week AND the Dashboard (its "Clases de hoy" derives from the same data).
function useInvalidateSchedule() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['schedule'] }),
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
    ]);
}

interface SaveVariables {
  /** Present when editing. */
  id?: string;
  input: CreateScheduleBlockRequest | UpdateScheduleBlockRequest;
  /** Validate and look for conflicts only: nothing is saved, nothing is invalidated. */
  dryRun?: boolean;
}

export function useSaveScheduleBlock() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: ({ id, input, dryRun = false }: SaveVariables) =>
      saveScheduleBlock(id, input, dryRun),
    onSuccess: (_result, { dryRun }) => (dryRun ? undefined : invalidate()),
  });
}

export function useDeleteScheduleBlock() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: deleteScheduleBlock, onSuccess: invalidate });
}
