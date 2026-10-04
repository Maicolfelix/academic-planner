import { Router, type RequestHandler } from 'express';
import type { createReminderController } from '../controllers/reminderController.js';

export function remindersRouter(
  controller: ReturnType<typeof createReminderController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth, controller.noStore); // every reminder route needs a session
  router.get('/', controller.list);
  // Fixed paths before `/:id`, so "due" and "seen" are never read as ids.
  router.get('/due', controller.due);
  router.post('/seen', controller.seen);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
