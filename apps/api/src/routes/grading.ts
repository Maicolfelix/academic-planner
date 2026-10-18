import { Router, type RequestHandler } from 'express';
import type { createGradingController } from '../controllers/gradingController.js';

/**
 * The grades routes live under several prefixes (a period, a cut, an evaluation, a subject), so this router is mounted at `/api`
 * and asks for the session ON EACH ROUTE: it must never put a login wall in front of `/api/auth` or `/api/health`.
 */
export function gradingRouter(
  controller: ReturnType<typeof createGradingController>,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.post('/periods/:id/grading', requireAuth, controller.setup);
  router.get('/periods/:id/grading', requireAuth, controller.getPeriod);
  router.patch('/periods/:id/grading', requireAuth, controller.updateProfile);
  router.post('/subjects/:id/grading/setup', requireAuth, controller.setupSubject);
  router.post('/subjects/:id/grading-periods', requireAuth, controller.createCut);
  router.post(
    '/subjects/:id/grading-periods/distribution',
    requireAuth,
    controller.replaceCutWeights,
  );
  router.patch('/grading-periods/:id', requireAuth, controller.updateCut);
  router.delete('/grading-periods/:id', requireAuth, controller.removeCut);
  router.post('/evaluations', requireAuth, controller.createEvaluation);
  router.patch('/evaluations/:id', requireAuth, controller.updateEvaluation);
  router.delete('/evaluations/:id', requireAuth, controller.removeEvaluation);
  router.get('/subjects/:id/grades', requireAuth, controller.subjectGrades);
  return router;
}
