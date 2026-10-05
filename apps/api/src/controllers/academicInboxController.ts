import { academicInboxRequestSchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { AcademicInboxService } from '../services/academicInboxService.js';

/**
 * The body is `{ text }` and nothing else (a userId, periodId or subjects list is rejected): owner, timezone,
 * period and subjects all come from the session. It only interprets; it never creates an Activity and it never
 * stores or logs the pasted text.
 */
export function createAcademicInboxController(service: AcademicInboxService) {
  return {
    parse: (async (req, res) => {
      const { text } = academicInboxRequestSchema.parse(req.body ?? {});
      const { id, timezone } = authOf(req).user;
      // Depends on the clock and on the user's data: never cache it.
      res.set('Cache-Control', 'no-store');
      res.json(await service.parse({ id, timezone }, text));
    }) satisfies RequestHandler,
  };
}
