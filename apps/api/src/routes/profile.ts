import { Router, type RequestHandler } from 'express';
import type { createProfileController } from '../controllers/profileController.js';

export function profileRouter(
  controller: ReturnType<typeof createProfileController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // the profile is the session user's: no session, no profile
  router.get('/', controller.get);
  router.patch('/', controller.update);
  return router;
}
