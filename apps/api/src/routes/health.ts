import { Router } from 'express';
import type { HealthResponse } from '@planner/core';

export function healthRouter(checkDatabase: () => Promise<boolean>): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const dbUp = await checkDatabase();
      const body: HealthResponse = {
        status: dbUp ? 'ok' : 'degraded',
        database: dbUp ? 'up' : 'down',
        timestamp: new Date().toISOString(),
      };
      res.status(dbUp ? 200 : 503).json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
