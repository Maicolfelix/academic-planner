import { Router, type RequestHandler } from 'express';
import type { createDashboardController } from '../controllers/dashboardController.js';

export function dashboardRouter(
  controller: ReturnType<typeof createDashboardController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/', requireAuth, controller.get);
  return router;
}
