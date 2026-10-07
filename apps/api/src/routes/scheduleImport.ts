import { Router, type RequestHandler } from 'express';
import type { createScheduleImportController } from '../controllers/scheduleImportController.js';

export function scheduleImportRouter(
  controller: ReturnType<typeof createScheduleImportController>,
  requireAuth: RequestHandler,
  /** An expensive endpoint (OCR): throttled after authentication. */
  limiter: RequestHandler,
): Router {
  const router = Router();
  router.post('/parse', requireAuth, limiter, controller.parse);
  // Writes (the classes and any new subject): the session's user only; JSON, same-origin like every other write.
  router.post('/confirm', requireAuth, controller.confirm);
  return router;
}
