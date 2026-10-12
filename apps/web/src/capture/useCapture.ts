import type { CaptureMode } from '@planner/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useInvalidateActivities } from '../activities/useActivities';
import { confirmCaptureRequest, parseCaptureRequest } from '../api/capture';
import { WORKLOAD_KEY } from '../insights/useInsights';

/** Interpreting is a mutation (a POST that changes nothing): nothing is cached and nothing is invalidated. */
export function useParseCapture() {
  return useMutation({
    mutationFn: ({ text, mode }: { text: string; mode: CaptureMode }) =>
      parseCaptureRequest(text, mode),
  });
}

/**
 * Confirming creates the ticked activities (and the new subjects) in one request. Everything that is derived from them is
 * refreshed at once, exactly as for one activity: the lists, Home, reminders, Radar, Attention, progress and workload —
 * and the subjects, which may have grown, and the agenda when weekly blocks were created. No reload is ever needed.
 */
export function useConfirmCapture() {
  const invalidateActivities = useInvalidateActivities();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmCaptureRequest,
    onSuccess: () =>
      Promise.all([
        invalidateActivities(),
        qc.invalidateQueries({ queryKey: ['subjects'] }),
        qc.invalidateQueries({ queryKey: ['schedule'] }),
        qc.invalidateQueries({ queryKey: WORKLOAD_KEY }),
      ]),
  });
}
