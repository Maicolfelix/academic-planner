import { createSubjectSchema, updateSubjectSchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { SubjectService } from '../services/subjectService.js';

const NOT_FOUND = 'Asignatura no encontrada.';
const listQuerySchema = z.object({ periodId: z.uuid('Periodo inválido.').optional() });

/** Thin HTTP layer: validate input, take the owner from the session, delegate to the service. */
export function createSubjectController(service: SubjectService) {
  const owner = (req: Parameters<RequestHandler>[0]) => authOf(req).user.id;

  return {
    list: (async (req, res) => {
      const { periodId } = listQuerySchema.parse(req.query);
      res.json({ subjects: await service.list(owner(req), periodId) });
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const input = createSubjectSchema.parse(req.body ?? {});
      res.status(201).json({ subject: await service.create(owner(req), input) });
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      res.json({ subject: await service.get(owner(req), id) });
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      const input = updateSubjectSchema.parse(req.body ?? {});
      res.json({ subject: await service.update(owner(req), id, input) });
    }) satisfies RequestHandler,

    remove: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      await service.remove(owner(req), id);
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
