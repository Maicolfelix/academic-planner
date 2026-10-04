import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { RadarService } from '../services/radarService.js';

/** Takes NO input: owner and timezone come from the session and the period is the user's current one. */
export function createRadarController(service: RadarService) {
  return {
    get: (async (req, res) => {
      const { id, timezone } = authOf(req).user;
      // Changes with time even when nothing is written: never cache it.
      res.set('Cache-Control', 'no-store');
      res.json({ radar: await service.get({ id, timezone }) });
    }) satisfies RequestHandler,
  };
}
