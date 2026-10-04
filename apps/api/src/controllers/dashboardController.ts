import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { DashboardService } from '../services/dashboardService.js';

/**
 * Takes NO input: the owner and the timezone come from the session and the period is the user's
 * current one. A `userId` or `periodId` in the query string is simply never read.
 */
export function createDashboardController(service: DashboardService) {
  return {
    get: (async (req, res) => {
      const { id, timezone } = authOf(req).user;
      // Personal, constantly changing data: never cache it in the browser or a proxy.
      res.set('Cache-Control', 'no-store');
      res.json({ dashboard: await service.get({ id, timezone }) });
    }) satisfies RequestHandler,
  };
}
