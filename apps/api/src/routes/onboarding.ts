import { Router, type RequestHandler } from 'express';
import type { createOnboardingController } from '../controllers/onboardingController.js';

export function onboardingRouter(
  controller: ReturnType<typeof createOnboardingController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // finishing the onboarding is the session user's: no session, nothing to finish
  router.post('/complete', controller.complete);
  return router;
}
