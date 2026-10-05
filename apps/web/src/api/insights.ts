import {
  progressResponseSchema,
  workloadResponseSchema,
  type Progress,
  type Workload,
} from '@planner/core';
import { apiFetch } from './client';

export async function fetchProgress(): Promise<Progress> {
  return (await apiFetch('/api/progress', { schema: progressResponseSchema })).progress;
}

/** `week` is any date of the wanted week (YYYY-MM-DD); without it the server uses the user's current local week. */
export async function fetchWorkload(week?: string): Promise<Workload> {
  const qs = week ? `?week=${encodeURIComponent(week)}` : '';
  return (await apiFetch(`/api/workload${qs}`, { schema: workloadResponseSchema })).workload;
}
