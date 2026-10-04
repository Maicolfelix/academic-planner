import { Router, type RequestHandler } from 'express';
import type { createRadarController } from '../controllers/radarController.js';

export function radarRouter(
  controller: ReturnType<typeof createRadarController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/', requireAuth, controller.get);
  return router;
}
