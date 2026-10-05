import { scheduleImportResultSchema, type ScheduleImportResult } from '@planner/core';
import { apiFetch } from './client';

/** Sends the file to be read. It only proposes: nothing is created and the file is not stored. */
export function parseScheduleImportRequest(
  file: File,
  signal?: AbortSignal,
): Promise<ScheduleImportResult> {
  const body = new FormData();
  body.append('file', file);
  return apiFetch('/api/schedule-import/parse', {
    method: 'POST',
    body,
    signal,
    schema: scheduleImportResultSchema,
  });
}
