import { Router, type RequestHandler } from 'express';
import type { createStudyTrackController } from '../controllers/studyTrackController.js';

export function studyTracksRouter(
  controller: ReturnType<typeof createStudyTrackController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth); // every study route needs a session
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);
  router.post('/:id/make-primary', controller.makePrimary);
  router.post('/:id/archive', controller.archive);
  router.post('/:id/restore', controller.restore);
  return router;
}
