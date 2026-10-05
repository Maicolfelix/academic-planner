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
  return router;
}
