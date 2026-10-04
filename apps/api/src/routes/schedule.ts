import { Router, type RequestHandler } from 'express';
import type { createScheduleController } from '../controllers/scheduleController.js';

export function scheduleRouter(
  controller: ReturnType<typeof createScheduleController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // every schedule route needs a session
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
