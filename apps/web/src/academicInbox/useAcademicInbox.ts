import { useMutation } from '@tanstack/react-query';
import { parseAcademicInboxRequest } from '../api/academicInbox';

/** Interpreting is a mutation that changes nothing; confirming reuses `useCreateActivity`. */
export function useParseAcademicInbox() {
  return useMutation({ mutationFn: parseAcademicInboxRequest });
}
