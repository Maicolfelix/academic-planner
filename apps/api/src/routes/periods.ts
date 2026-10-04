import { Router, type RequestHandler } from 'express';
import type { createPeriodController } from '../controllers/periodController.js';

export function periodsRouter(
  controller: ReturnType<typeof createPeriodController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // every period route needs a session
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
