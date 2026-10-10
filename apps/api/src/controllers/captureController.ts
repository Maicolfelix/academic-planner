import { captureRequestSchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { CaptureService } from '../services/captureService.js';

/**
 * The body is `{ text, mode }` and nothing else (a userId, periodId or subjects list is rejected): owner, timezone,
 * period and subjects all come from the session. It only interprets; it never creates anything.
 */
export function createCaptureController(service: CaptureService) {
  return {
    parse: (async (req, res) => {
      const { text, mode } = captureRequestSchema.parse(req.body ?? {});
      const { id, timezone } = authOf(req).user;
      // Depends on the clock and on the user's subjects: never cache it.
      res.set('Cache-Control', 'no-store');
      res.json(await service.parse({ id, timezone }, text, mode));
    }) satisfies RequestHandler,
  };
}
