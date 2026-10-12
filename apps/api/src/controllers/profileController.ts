import { updateProfileSchema, type ProfileResponse } from '@planner/core';
import type { RequestHandler } from 'express';
import { authOf } from '../middleware/requireAuth.js';
import type { ProfileService } from '../services/profileService.js';

/** Thin HTTP layer: validate input, take the owner from the session ONLY (there is no id in the URL), delegate. */
export function createProfileController(service: ProfileService) {
  return {
    get: (async (req, res) => {
      res.json({ profile: await service.get(authOf(req).user.id) } satisfies ProfileResponse);
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const input = updateProfileSchema.parse(req.body ?? {});
      res.json({
        profile: await service.update(authOf(req).user.id, input),
      } satisfies ProfileResponse);
    }) satisfies RequestHandler,
  };
}
