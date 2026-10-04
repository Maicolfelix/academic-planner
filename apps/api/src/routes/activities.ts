import { Router, type RequestHandler } from 'express';
import type { createActivityController } from '../controllers/activityController.js';

export function activitiesRouter(
  controller: ReturnType<typeof createActivityController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // every activity route needs a session
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
