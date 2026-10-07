import {
  confirmScheduleImportResponseSchema,
  scheduleImportResultSchema,
  type ConfirmScheduleImportRequest,
  type ScheduleImportResult,
} from '@planner/core';
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

/**
 * Creates what the student reviewed, in ONE request: the classes and the new subjects they need, all or nothing. A refused
 * class comes back in `details.items` (by client id) and nothing is saved.
 */
export const confirmScheduleImportRequest = (input: ConfirmScheduleImportRequest) =>
  apiFetch('/api/schedule-import/confirm', {
    method: 'POST',
    body: input,
    schema: confirmScheduleImportResponseSchema,
  });
