import { Router, type RequestHandler } from 'express';
import type { createQuickCaptureController } from '../controllers/quickCaptureController.js';

export function quickCaptureRouter(
  controller: ReturnType<typeof createQuickCaptureController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.post('/parse', requireAuth, controller.parse);
  return router;
}
