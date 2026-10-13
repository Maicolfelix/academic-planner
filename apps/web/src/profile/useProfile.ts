import type { Profile } from '@planner/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProfile, updateProfileRequest } from '../api/profile';

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
