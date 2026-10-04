import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { AttentionService } from '../services/attentionService.js';

/** Takes NO input: owner and timezone come from the session; a userId or periodId in the query is never read. */
export function createAttentionController(service: AttentionService) {
  return {
    get: (async (req, res) => {
      const { id, timezone } = authOf(req).user;
      // Depends on the clock even when nothing is written: never cache it.
      res.set('Cache-Control', 'no-store');
      res.json({ attention: await service.get({ id, timezone }) });
    }) satisfies RequestHandler,
  };
}
