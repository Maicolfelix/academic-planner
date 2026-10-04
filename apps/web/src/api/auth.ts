import {
  authResponseSchema,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
} from '@planner/core';
import { ApiRequestError, apiFetch } from './client';

/** The backend is the authority on the session: `null` means "not signed in" (401), not an error. */
export async function fetchMe(): Promise<PublicUser | null> {
  try {
    return (await apiFetch('/api/auth/me', { schema: authResponseSchema })).user;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return null;
    throw err;
  }
}

export const registerRequest = async (input: RegisterInput): Promise<PublicUser> =>
  (
    await apiFetch('/api/auth/register', {
      method: 'POST',
      body: input,
      schema: authResponseSchema,
    })
  ).user;

export const loginRequest = async (input: LoginInput): Promise<PublicUser> =>
  (await apiFetch('/api/auth/login', { method: 'POST', body: input, schema: authResponseSchema }))
    .user;

export const logoutRequest = (): Promise<void> => apiFetch('/api/auth/logout', { method: 'POST' });
