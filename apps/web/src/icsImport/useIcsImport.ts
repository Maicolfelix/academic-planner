import { useMutation, useQueryClient } from '@tanstack/react-query';
import { confirmIcsRequest, parseIcsRequest } from '../api/icsImport';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { PROGRESS_KEY, WORKLOAD_KEY } from '../insights/useInsights';

/** Reading the file is a mutation that changes nothing; creating is `useConfirmIcsImport`. */
export function useParseIcs() {
  return useMutation({
    mutationFn: ({ file, signal }: { file: File; signal?: AbortSignal }) =>
      parseIcsRequest(file, signal),
  });
}

/** One request creates the reviewed activities and classes. It touches everything an activity or a class touches. */
export function useConfirmIcsImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmIcsRequest,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['activities'] }),
        qc.invalidateQueries({ queryKey: ['schedule'] }),
        qc.invalidateQueries({ queryKey: ['reminders'] }),
        qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
        qc.invalidateQueries({ queryKey: PROGRESS_KEY }),
        qc.invalidateQueries({ queryKey: WORKLOAD_KEY }),
      ]),
  });
}
