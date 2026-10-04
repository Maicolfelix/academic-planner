import { dashboardResponseSchema, type Dashboard } from '@planner/core';
import { apiFetch } from './client';

export async function fetchDashboard(): Promise<Dashboard> {
  return (await apiFetch('/api/dashboard', { schema: dashboardResponseSchema })).dashboard;
}
