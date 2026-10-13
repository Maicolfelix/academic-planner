import { profileResponseSchema, type Profile, type UpdateProfileRequest } from '@planner/core';
import { apiFetch } from './client';

/** The educational profile of the signed-in user (it is not part of `me`: the app does not depend on it). */
export async function fetchProfile(): Promise<Profile> {
  return (await apiFetch('/api/profile', { schema: profileResponseSchema })).profile;
}

export async function updateProfileRequest(input: UpdateProfileRequest): Promise<Profile> {
  return (
    await apiFetch('/api/profile', { method: 'PATCH', body: input, schema: profileResponseSchema })
  ).profile;
}
