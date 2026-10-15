import {
  adoptPeriodResponseSchema,
  setupStudyTrackResponseSchema,
  studyTrackListResponseSchema,
  studyTrackResponseSchema,
  type AdoptPeriodRequest,
  type AdoptPeriodResponse,
  type SetupStudyTrackRequest,
  type SetupStudyTrackResponse,
  type StudyTrack,
  type UpdateStudyTrackRequest,
} from '@planner/core';
import { apiFetch } from './client';

export async function fetchStudyTracks(): Promise<StudyTrack[]> {
  return (await apiFetch('/api/study-tracks', { schema: studyTrackListResponseSchema }))
    .studyTracks;
}

// Each action that can change which period is the HOME one answers the whole list.
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

/** Name, type and catalog key only (the server decides everything else). */
export async function updateStudyTrackRequest(
  id: string,
  input: UpdateStudyTrackRequest,
): Promise<StudyTrack> {
  return (
    await apiFetch(`/api/study-tracks/${id}`, {
      method: 'PATCH',
      body: input,
      schema: studyTrackResponseSchema,
    })
  ).studyTrack;
}

/** A study, its first period and (optionally) its first subjects in ONE request: all or nothing. */
export async function setupStudyRequest(
  input: SetupStudyTrackRequest,
): Promise<SetupStudyTrackResponse> {
  return apiFetch('/api/study-tracks/setup', {
    method: 'POST',
    body: input,
    schema: setupStudyTrackResponseSchema,
  });
}

/** A new study that takes over an existing period of the user that has no study: nothing is copied. */
export async function adoptPeriodRequest(input: AdoptPeriodRequest): Promise<AdoptPeriodResponse> {
  return apiFetch('/api/study-tracks/adopt-period', {
    method: 'POST',
    body: input,
    schema: adoptPeriodResponseSchema,
  });
}
