import { Router, type RequestHandler } from 'express';
import type { createCaptureController } from '../controllers/captureController.js';

export function captureRouter(
  controller: ReturnType<typeof createCaptureController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.post('/parse', requireAuth, controller.parse);
  return router;
}
