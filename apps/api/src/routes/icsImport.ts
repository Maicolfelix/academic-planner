import { Router, type RequestHandler } from 'express';
import type { createIcsImportController } from '../controllers/icsImportController.js';

export function icsImportRouter(
  controller: ReturnType<typeof createIcsImportController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  // Reads the file and PROPOSES: nothing is created.
  router.post('/parse', requireAuth, controller.parse);
  // Creates what the student reviewed, all or nothing; JSON, same-origin like every other write.
  router.post('/confirm', requireAuth, controller.confirm);
  return router;
}
