import { useMutation } from '@tanstack/react-query';
import { parseQuickCaptureRequest } from '../api/quickCapture';

/**
 * Interpreting is a mutation (a POST that changes nothing): nothing is cached and nothing is invalidated.
 * CONFIRMING reuses the normal activity mutation (`useCreateActivity`), which already refreshes the activity
 * lists, the Dashboard, reminders, Radar, Attention, progress and workload.
 */
export function useParseQuickCapture() {
  return useMutation({ mutationFn: parseQuickCaptureRequest });
}
