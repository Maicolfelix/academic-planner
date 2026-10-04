import {
  createActivitySchema,
  listActivitiesQuerySchema,
  updateActivitySchema,
} from '@planner/core';
import type { Request, RequestHandler } from 'express';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { ActivityService } from '../services/activityService.js';

const NOT_FOUND = 'Actividad no encontrada.';

/** Thin HTTP layer: validate input, take the owner (and timezone) from the session, delegate. */
export function createActivityController(service: ActivityService) {
  const actor = (req: Request) => {
    const { id, timezone } = authOf(req).user;
    return { id, timezone };
  };

  return {
    list: (async (req, res) => {
      const query = listActivitiesQuerySchema.parse(req.query);
      res.json({ activities: await service.list(actor(req), query) });
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const input = createActivitySchema.parse(req.body ?? {});
      res.status(201).json({ activity: await service.create(actor(req), input) });
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      res.json({ activity: await service.get(actor(req), id) });
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      const input = updateActivitySchema.parse(req.body ?? {});
      res.json({ activity: await service.update(actor(req), id, input) });
    }) satisfies RequestHandler,

    remove: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      await service.remove(actor(req), id);
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
