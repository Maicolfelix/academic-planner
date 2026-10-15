import type { RequestHandler } from 'express';
import { z } from 'zod';
import { authOf } from '../middleware/requireAuth.js';
import type { OnboardingService } from '../services/onboardingService.js';

/** The body is empty and strict: nothing the client could say (an id, a name, a type, a program) is ever read or ignored. */
const noBody = z.strictObject({});

/** Thin HTTP layer: validate (there is nothing to read), take the owner from the session ONLY, delegate. */
export function createOnboardingController(service: OnboardingService) {
  return {
    complete: (async (req, res) => {
      noBody.parse(req.body ?? {});
      res.json(await service.complete(authOf(req).user.id));
    }) satisfies RequestHandler,
  };
}
