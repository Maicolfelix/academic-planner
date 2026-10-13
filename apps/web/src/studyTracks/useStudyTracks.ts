import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAfterHomeChange } from '../academic/useAcademic';
import {
  archiveStudyTrackRequest,
  makeStudyTrackPrimaryRequest,
  restoreStudyTrackRequest,
} from '../api/studyTracks';

// Making another study the primary one, archiving one and restoring one can each change the HOME period without touching any
// period, so each refreshes everything that depends on it (see `invalidateAfterHomeChange`). No screen uses them yet.
function useStudyTrackAction(mutationFn: (id: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => invalidateAfterHomeChange(qc) });
}

export const useMakeStudyTrackPrimary = () => useStudyTrackAction(makeStudyTrackPrimaryRequest);
export const useArchiveStudyTrack = () => useStudyTrackAction(archiveStudyTrackRequest);
export const useRestoreStudyTrack = () => useStudyTrackAction(restoreStudyTrackRequest);
