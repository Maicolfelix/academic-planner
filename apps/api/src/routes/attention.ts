import { Router, type RequestHandler } from 'express';
import type { createAttentionController } from '../controllers/attentionController.js';

export function attentionRouter(
  controller: ReturnType<typeof createAttentionController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.get('/', requireAuth, controller.get);
  return router;
}
