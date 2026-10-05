import { Router, type RequestHandler } from 'express';
import type {
  createProgressController,
  createWorkloadController,
} from '../controllers/insightsController.js';

export function progressRouter(
  controller: ReturnType<typeof createProgressController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/', requireAuth, controller.get);
  return router;
}

export function workloadRouter(
  controller: ReturnType<typeof createWorkloadController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/', requireAuth, controller.get);
  return router;
}
