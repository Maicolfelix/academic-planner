import { Router, type RequestHandler } from 'express';
import type { createSubjectController } from '../controllers/subjectController.js';

export function subjectsRouter(
  controller: ReturnType<typeof createSubjectController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // every subject route needs a session
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
