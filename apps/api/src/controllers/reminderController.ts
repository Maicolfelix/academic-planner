import {
  createReminderSchema,
  listRemindersQuerySchema,
  markSeenSchema,
  updateReminderSchema,
} from '@planner/core';
import type { Request, RequestHandler } from 'express';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { ReminderService } from '../services/reminderService.js';

const NOT_FOUND = 'Recordatorio no encontrado.';

/** Thin HTTP layer: validate input, take the owner (and timezone) from the session, delegate. */
export function createReminderController(service: ReminderService) {
  const actor = (req: Request) => {
    const { id, timezone } = authOf(req).user;
    return { id, timezone };
  };
  // Personal, time-dependent data: never cached by the browser or a proxy.
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  return {
    noStore,

    list: (async (req, res) => {
      const filter = listRemindersQuerySchema.parse(req.query);
      res.json({ reminders: await service.list(actor(req), filter) });
    }) satisfies RequestHandler,

    due: (async (req, res) => {
      res.json(await service.due(actor(req)));
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const input = createReminderSchema.parse(req.body ?? {});
      res.status(201).json({ reminder: await service.create(actor(req), input) });
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      const input = updateReminderSchema.parse(req.body ?? {});
      res.json({ reminder: await service.update(actor(req), id, input) });
    }) satisfies RequestHandler,

    remove: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      await service.remove(actor(req), id);
      res.status(204).end();
    }) satisfies RequestHandler,

    seen: (async (req, res) => {
      const { ids } = markSeenSchema.parse(req.body ?? {});
      res.json(await service.markShown(actor(req), ids));
    }) satisfies RequestHandler,
  };
}
