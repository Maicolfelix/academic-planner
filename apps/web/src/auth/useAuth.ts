import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMe, loginRequest, logoutRequest, registerRequest } from '../api/auth';

export const ME_KEY = ['me'] as const;

/**
 * The only holder of "who is signed in": the TanStack Query cache entry for GET /api/auth/me.
 * `data === null` means signed out; the backend stays the source of truth.
 */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: 60_000 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: loginRequest,
    onSuccess: (user) => qc.setQueryData(ME_KEY, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerRequest,
    onSuccess: (user) => qc.setQueryData(ME_KEY, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logoutRequest,
    // Drop every cached answer so nothing from the previous session can be shown to the next one.
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}
