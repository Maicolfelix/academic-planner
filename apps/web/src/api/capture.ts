import {
  captureConfirmResponseSchema,
  captureResponseSchema,
  type CaptureConfirmRequest,
  type CaptureConfirmResponse,
  type CaptureMode,
  type CaptureResponse,
} from '@planner/core';
import { apiFetch } from './client';

/** Interprets a text into proposals. It only proposes: nothing is created or stored. */
export const parseCaptureRequest = (text: string, mode: CaptureMode): Promise<CaptureResponse> =>
  apiFetch('/api/capture/parse', {
    method: 'POST',
    body: { text, mode },
    schema: captureResponseSchema,
  });

/** Creates what the student ticked, all together or not at all. */
export const confirmCaptureRequest = (
  input: CaptureConfirmRequest,
): Promise<CaptureConfirmResponse> =>
  apiFetch('/api/capture/confirm', {
    method: 'POST',
    body: input,
    schema: captureConfirmResponseSchema,
  });
