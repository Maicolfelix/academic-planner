import {
  activityListResponseSchema,
  activityResponseSchema,
  type Activity,
  type ActivityPriority,
  type ActivityStatus,
  type ActivityType,
  type CreateActivityInput,
  type UpdateActivityRequest,
} from '@planner/core';
import { apiFetch } from './client';

export interface ActivityQuery {
  periodId?: string;
  subjectId?: string;
  status?: ActivityStatus;
  priority?: ActivityPriority;
  type?: ActivityType;
  overdue?: boolean;
}

export async function fetchActivities(query: ActivityQuery): Promise<Activity[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return (
    await apiFetch(`/api/activities${qs ? `?${qs}` : ''}`, { schema: activityListResponseSchema })
  ).activities;
}

export async function createActivityRequest(input: CreateActivityInput): Promise<Activity> {
  return (
    await apiFetch('/api/activities', {
      method: 'POST',
      body: input,
      schema: activityResponseSchema,
    })
  ).activity;
}

export async function updateActivityRequest(
  id: string,
  input: UpdateActivityRequest,
): Promise<Activity> {
  return (
    await apiFetch(`/api/activities/${id}`, {
      method: 'PATCH',
      body: input,
      schema: activityResponseSchema,
    })
  ).activity;
}

export const deleteActivityRequest = (id: string): Promise<void> =>
  apiFetch(`/api/activities/${id}`, { method: 'DELETE' });
