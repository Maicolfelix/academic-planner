import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePeriodInput,
  UpdatePeriodRequest,
  UpdateStudyTrackRequest,
} from '@planner/core';
import { invalidateAfterHomeChange } from '../academic/useAcademic';
import { createPeriodRequest, updatePeriodRequest } from '../api/academic';
import {
  adoptPeriodRequest,
  archiveStudyTrackRequest,
  fetchStudyTracks,
  makeStudyTrackPrimaryRequest,
  restoreStudyTrackRequest,
  setupStudyRequest,
  updateStudyTrackRequest,
} from '../api/studyTracks';

export const studyTracksKey = ['study-tracks'] as const;

/** The studies of the user, in the API's order (the primary first, then the active ones, then the archived). */
export function useStudyTracks() {
  return useQuery({ queryKey: studyTracksKey, queryFn: fetchStudyTracks, retry: false });
}

/**
 * EVERY study mutation refreshes through `invalidateAfterHomeChange` (one place): a study can move the HOME period, change the
 * set of current periods and so the labels, the Activities list, the subjects, the Dashboard, the Radar, the Progress... none
 * of that can be left stale. It leaves out only who the user is and their profile, which no study mutation touches.
 */
function useStudyMutation<V, R>(mutationFn: (variables: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => invalidateAfterHomeChange(qc) });
}

export const useMakeStudyTrackPrimary = () => useStudyMutation(makeStudyTrackPrimaryRequest);
export const useArchiveStudyTrack = () => useStudyMutation(archiveStudyTrackRequest);
export const useRestoreStudyTrack = () => useStudyMutation(restoreStudyTrackRequest);
export const useUpdateStudyTrack = () =>
  useStudyMutation(({ id, input }: { id: string; input: UpdateStudyTrackRequest }) =>
    updateStudyTrackRequest(id, input),
  );
export const useSetupStudy = () => useStudyMutation(setupStudyRequest);
export const useAdoptPeriod = () => useStudyMutation(adoptPeriodRequest);

// The periods of a study: marking one current replaces the current one of its scope, which changes what every list reads.
export const useCreateStudyPeriod = () =>
  useStudyMutation((input: CreatePeriodInput) => createPeriodRequest(input));
export const useUpdateStudyPeriod = () =>
  useStudyMutation(({ id, input }: { id: string; input: UpdatePeriodRequest }) =>
    updatePeriodRequest(id, input),
  );
