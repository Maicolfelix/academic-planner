import {
  scheduleBlockResponseSchema,
  scheduleListResponseSchema,
  scheduleWriteResponseSchema,
  type CreateScheduleBlockRequest,
  type ScheduleBlock,
  type UpdateScheduleBlockRequest,
} from '@planner/core';
import { apiFetch } from './client';

/** The occurrences inside [from, to] (the user's local days). Only that range is ever transferred. */
export const fetchSchedule = (from: string, to: string) =>
  apiFetch(`/api/schedule?from=${from}&to=${to}`, { schema: scheduleListResponseSchema });

export async function fetchScheduleBlock(id: string): Promise<ScheduleBlock> {
  return (await apiFetch(`/api/schedule/${id}`, { schema: scheduleBlockResponseSchema })).block;
}

/**
 * Creates (no `id`) or edits (`id`) a block. `dryRun` validates and reports conflicts without saving,
 * so the form can warn the user before they commit.
 */
export function saveScheduleBlock(
  id: string | undefined,
  input: CreateScheduleBlockRequest | UpdateScheduleBlockRequest,
  dryRun: boolean,
) {
  return apiFetch(`/api/schedule${id ? `/${id}` : ''}${dryRun ? '?dryRun=true' : ''}`, {
    method: id ? 'PATCH' : 'POST',
    body: input,
    schema: scheduleWriteResponseSchema,
  });
}

export const deleteScheduleBlock = (id: string): Promise<void> =>
  apiFetch(`/api/schedule/${id}`, { method: 'DELETE' });
