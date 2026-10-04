import { radarResponseSchema, type Radar } from '@planner/core';
import { apiFetch } from './client';

export async function fetchRadar(): Promise<Radar> {
  return (await apiFetch('/api/radar', { schema: radarResponseSchema })).radar;
}
