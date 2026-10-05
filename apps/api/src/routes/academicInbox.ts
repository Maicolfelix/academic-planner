import { Router, type RequestHandler } from 'express';
import type { createAcademicInboxController } from '../controllers/academicInboxController.js';

export function academicInboxRouter(
  controller: ReturnType<typeof createAcademicInboxController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.post('/parse', requireAuth, controller.parse);
  return router;
}
