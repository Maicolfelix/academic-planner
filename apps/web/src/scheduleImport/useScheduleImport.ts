import { useMutation } from '@tanstack/react-query';
import { parseScheduleImportRequest } from '../api/scheduleImport';

/** Reading the file is a mutation that changes nothing; creating the classes reuses `useSaveScheduleBlock`. */
export function useParseScheduleImport() {
  return useMutation({
    mutationFn: ({ file, signal }: { file: File; signal?: AbortSignal }) =>
      parseScheduleImportRequest(file, signal),
  });
}
