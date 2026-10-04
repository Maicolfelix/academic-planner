import { workloadQuerySchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { ProgressService } from '../services/progressService.js';
import type { WorkloadService } from '../services/workloadService.js';

/**
 * Owner and timezone come from the session; the period is the user's current one. A `userId` or `periodId` in
 * the query string is never read. The answers depend on the clock and on writes, so they are never cached.
 */
export function createProgressController(service: ProgressService) {
  return {
    get: (async (req, res) => {
      const { id, timezone } = authOf(req).user;
      res.set('Cache-Control', 'no-store');
      res.json({ progress: await service.get({ id, timezone }) });
    }) satisfies RequestHandler,
  };
}

export function createWorkloadController(service: WorkloadService) {
  return {
    get: (async (req, res) => {
      const { id, timezone } = authOf(req).user;
      const query = workloadQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ workload: await service.get({ id, timezone }, query) });
    }) satisfies RequestHandler,
  };
}
