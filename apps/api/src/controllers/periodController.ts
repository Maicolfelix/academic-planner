import { createPeriodSchema, updatePeriodSchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { PeriodService } from '../services/periodService.js';

const NOT_FOUND = 'Periodo no encontrado.';

/** Thin HTTP layer: validate input, take the owner from the session, delegate to the service. */
export function createPeriodController(service: PeriodService) {
  const owner = (req: Parameters<RequestHandler>[0]) => authOf(req).user.id;

  return {
    list: (async (req, res) => {
      res.json({ periods: await service.list(owner(req)) });
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const input = createPeriodSchema.parse(req.body ?? {});
      res.status(201).json({ period: await service.create(owner(req), input) });
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      res.json({ period: await service.get(owner(req), id) });
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      const input = updatePeriodSchema.parse(req.body ?? {});
      res.json({ period: await service.update(owner(req), id, input) });
    }) satisfies RequestHandler,

    remove: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      await service.remove(owner(req), id);
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
