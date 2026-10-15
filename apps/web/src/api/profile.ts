import {
  completeOnboardingResponseSchema,
  profileResponseSchema,
  type CompleteOnboardingResponse,
  type Profile,
  type UpdateProfileRequest,
} from '@planner/core';
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

/**
 * Finishes the onboarding. No body: the server derives everything from what the wizard already saved, and for a student who
 * studies it turns the period they made into the first period of their primary study (nothing is copied). Idempotent.
 */
export async function completeOnboardingRequest(): Promise<CompleteOnboardingResponse> {
  return apiFetch('/api/onboarding/complete', {
    method: 'POST',
    body: {},
    schema: completeOnboardingResponseSchema,
  });
}
