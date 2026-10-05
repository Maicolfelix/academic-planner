import { academicInboxResponseSchema, type AcademicInboxResponse } from '@planner/core';
import { apiFetch } from './client';

/** Interprets a pasted message. It only proposes: nothing is created or stored. */
export const parseAcademicInboxRequest = (text: string): Promise<AcademicInboxResponse> =>
  apiFetch('/api/academic-inbox/parse', {
    method: 'POST',
    body: { text },
    schema: academicInboxResponseSchema,
  });
