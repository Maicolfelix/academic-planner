import {
  createScheduleBlockSchema,
  scheduleQuerySchema,
  updateScheduleBlockSchema,
} from '@planner/core';
import type { Request, RequestHandler } from 'express';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { ScheduleService } from '../services/scheduleService.js';

const NOT_FOUND = 'Bloque de agenda no encontrado.';

/** `?dryRun=true` validates and reports conflicts without saving anything. */
const isDryRun = (req: Request) => req.query.dryRun === 'true';

/** Thin HTTP layer: validate input, take the owner (and timezone) from the session, delegate. */
export function createScheduleController(service: ScheduleService) {
  const actor = (req: Request) => {
    const { id, timezone } = authOf(req).user;
    return { id, timezone };
  };

  return {
    list: (async (req, res) => {
      const query = scheduleQuerySchema.parse(req.query);
      res.json(await service.list(actor(req), query));
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const input = createScheduleBlockSchema.parse(req.body ?? {});
      const dryRun = isDryRun(req);
      const result = await service.create(actor(req), input, { dryRun });
      res.status(dryRun ? 200 : 201).json(result);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      res.json({ block: await service.get(actor(req), id) });
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      const input = updateScheduleBlockSchema.parse(req.body ?? {});
      res.json(await service.update(actor(req), id, input, { dryRun: isDryRun(req) }));
    }) satisfies RequestHandler,

    remove: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      await service.remove(actor(req), id);
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
