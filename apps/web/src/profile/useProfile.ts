import type { Profile } from '@planner/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateAfterHomeChange } from '../academic/useAcademic';
import { completeOnboardingRequest, fetchProfile, updateProfileRequest } from '../api/profile';

export const PROFILE_KEY = ['profile'] as const;

/** The server is the authority: this is the cache of GET /api/profile, nothing is kept anywhere else. */
export function useProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile, retry: false });
}

/** The answer of the PATCH IS the new profile: it replaces the cached one, so nothing needs to be fetched again. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProfileRequest,
    onSuccess: (profile: Profile) => qc.setQueryData(PROFILE_KEY, profile),
  });
}

/**
 * Finishing the onboarding can create the student's primary study and link their period to it, so it refreshes everything that
 * depends on that (the studies, the labels, the Home...) through the ONE shared invalidation, after putting the new profile in
 * the cache. The mutation waits for it, so the screen that follows reads the finished state.
 */
export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: completeOnboardingRequest,
    onSuccess: async (res) => {
      qc.setQueryData(PROFILE_KEY, res.profile);
      await invalidateAfterHomeChange(qc);
    },
  });
}
