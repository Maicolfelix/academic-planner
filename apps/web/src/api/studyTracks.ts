import { studyTrackListResponseSchema, type StudyTrack } from '@planner/core';
import { apiFetch } from './client';

// Only the actions that can change which period is the HOME one (there is no studies screen yet): each answers the whole list.
const action = async (
  id: string,
  name: 'make-primary' | 'archive' | 'restore',
): Promise<StudyTrack[]> =>
  (
    await apiFetch(`/api/study-tracks/${id}/${name}`, {
      method: 'POST',
      schema: studyTrackListResponseSchema,
    })
  ).studyTracks;

export const makeStudyTrackPrimaryRequest = (id: string) => action(id, 'make-primary');
export const archiveStudyTrackRequest = (id: string) => action(id, 'archive');
export const restoreStudyTrackRequest = (id: string) => action(id, 'restore');
