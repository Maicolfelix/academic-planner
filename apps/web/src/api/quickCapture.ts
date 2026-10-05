import { quickCaptureResponseSchema, type QuickCaptureResponse } from '@planner/core';
import { apiFetch } from './client';

/** Interprets a phrase. It only proposes: nothing is created. */
export const parseQuickCaptureRequest = (text: string): Promise<QuickCaptureResponse> =>
  apiFetch('/api/quick-capture/parse', {
    method: 'POST',
    body: { text },
    schema: quickCaptureResponseSchema,
  });
