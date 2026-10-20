import {
  confirmIcsImportResponseSchema,
  icsParseResponseSchema,
  type ConfirmIcsImportRequest,
  type IcsParseResponse,
} from '@planner/core';
import { apiFetch } from './client';

/** Sends the .ics to be read. It only proposes: nothing is created and the file is not stored. */
export function parseIcsRequest(file: File, signal?: AbortSignal): Promise<IcsParseResponse> {
  const body = new FormData();
  body.append('file', file);
  return apiFetch('/api/ics-import/parse', {
    method: 'POST',
    body,
    signal,
    schema: icsParseResponseSchema,
  });
}

/** Creates what the student reviewed in ONE request: all or nothing. A refused item comes back in `details.items`. */
export const confirmIcsRequest = (input: ConfirmIcsImportRequest) =>
  apiFetch('/api/ics-import/confirm', {
    method: 'POST',
    body: input,
    schema: confirmIcsImportResponseSchema,
  });
