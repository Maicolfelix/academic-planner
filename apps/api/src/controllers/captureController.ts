import { captureConfirmSchema, captureRequestSchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { CaptureConfirmService } from '../services/captureConfirmService.js';
import type { CaptureService } from '../services/captureService.js';

/**
 * `parse`: the body is `{ text, mode }` and nothing else (a userId, periodId or subjects list is rejected): owner,
 * timezone, period and subjects all come from the session. It only interprets; it never creates anything.
 * `confirm`: the proposals the student kept, created all together or not at all; the owner and the period come from the
 * session and the stored data, never from the body.
 */
export function createCaptureController(
  service: CaptureService,
  confirmService: CaptureConfirmService,
) {
  return {
    confirm: (async (req, res) => {
      const input = captureConfirmSchema.parse(req.body ?? {});
      const { id, timezone } = authOf(req).user;
      res.set('Cache-Control', 'no-store');
      res.status(201).json(await confirmService.confirm({ id, timezone }, input));
    }) satisfies RequestHandler,

    parse: (async (req, res) => {
      const { text, mode } = captureRequestSchema.parse(req.body ?? {});
      const { id, timezone } = authOf(req).user;
      // Depends on the clock and on the user's subjects: never cache it.
      res.set('Cache-Control', 'no-store');
      res.json(await service.parse({ id, timezone }, text, mode));
    }) satisfies RequestHandler,
  };
}
