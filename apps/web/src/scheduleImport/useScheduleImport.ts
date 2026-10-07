import { useMutation, useQueryClient } from '@tanstack/react-query';
import { confirmScheduleImportRequest, parseScheduleImportRequest } from '../api/scheduleImport';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { PROGRESS_KEY, WORKLOAD_KEY } from '../insights/useInsights';

/** Reading the file is a mutation that changes nothing; creating the classes is `useConfirmScheduleImport`. */
export function useParseScheduleImport() {
  return useMutation({
    mutationFn: ({ file, signal }: { file: File; signal?: AbortSignal }) =>
      parseScheduleImportRequest(file, signal),
  });
}

/**
 * One request creates the reviewed classes and any new subject. It touches everything a subject or a class touches: the
 * subject lists, every cached week, the Dashboard, the progress and the weekly workload.
 */
export function useConfirmScheduleImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmScheduleImportRequest,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['subjects'] }),
        qc.invalidateQueries({ queryKey: ['schedule'] }),
        qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
        qc.invalidateQueries({ queryKey: PROGRESS_KEY }),
        qc.invalidateQueries({ queryKey: WORKLOAD_KEY }),
      ]),
  });
}
