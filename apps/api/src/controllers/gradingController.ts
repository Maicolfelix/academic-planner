import {
  createEvaluationSchema,
  createGradingPeriodSchema,
  createGradingProfileSchema,
  setupSubjectGradingSchema,
  updateEvaluationSchema,
  updateGradingPeriodSchema,
  updateGradingProfileSchema,
} from '@planner/core';
import type { RequestHandler } from 'express';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { GradingService } from '../services/gradingService.js';

/** Thin HTTP layer: validate the (strict) body, take the owner from the session ONLY, delegate. */
export function createGradingController(service: GradingService) {
  const owner = (req: Parameters<RequestHandler>[0]) => authOf(req).user.id;

  return {
    setup: (async (req, res) => {
      const periodId = parseIdParam(req.params.id, 'Periodo no encontrado.');
      const input = createGradingProfileSchema.parse(req.body ?? {});
      res.status(201).json({ profile: await service.setupProfile(owner(req), periodId, input) });
    }) satisfies RequestHandler,

    /** How a subject splits its final grade (and, the first time, the period's scale) in one atomic request. */
    setupSubject: (async (req, res) => {
      const subjectId = parseIdParam(req.params.id, 'Asignatura no encontrada.');
      const input = setupSubjectGradingSchema.parse(req.body ?? {});
      res.status(201).json(await service.setupSubjectGrading(owner(req), subjectId, input));
    }) satisfies RequestHandler,

    getPeriod: (async (req, res) => {
      const periodId = parseIdParam(req.params.id, 'Periodo no encontrado.');
      res.json(await service.getPeriodGrading(owner(req), periodId));
    }) satisfies RequestHandler,

    updateProfile: (async (req, res) => {
      const periodId = parseIdParam(req.params.id, 'Periodo no encontrado.');
      const input = updateGradingProfileSchema.parse(req.body ?? {});
      res.json({ profile: await service.updateProfile(owner(req), periodId, input) });
    }) satisfies RequestHandler,

    createCut: (async (req, res) => {
      const subjectId = parseIdParam(req.params.id, 'Asignatura no encontrada.');
      const input = createGradingPeriodSchema.parse(req.body ?? {});
      res
        .status(201)
        .json({ gradingPeriod: await service.createCut(owner(req), subjectId, input) });
    }) satisfies RequestHandler,

    updateCut: (async (req, res) => {
      const id = parseIdParam(req.params.id, 'Corte no encontrado.');
      const input = updateGradingPeriodSchema.parse(req.body ?? {});
      res.json({ gradingPeriod: await service.updateCut(owner(req), id, input) });
    }) satisfies RequestHandler,

    removeCut: (async (req, res) => {
      await service.removeCut(owner(req), parseIdParam(req.params.id, 'Corte no encontrado.'));
      res.status(204).end();
    }) satisfies RequestHandler,

    createEvaluation: (async (req, res) => {
      const input = createEvaluationSchema.parse(req.body ?? {});
      res.status(201).json({ evaluation: await service.createEvaluation(owner(req), input) });
    }) satisfies RequestHandler,

    updateEvaluation: (async (req, res) => {
      const id = parseIdParam(req.params.id, 'Evaluación no encontrada.');
      const input = updateEvaluationSchema.parse(req.body ?? {});
      res.json({ evaluation: await service.updateEvaluation(owner(req), id, input) });
    }) satisfies RequestHandler,

    removeEvaluation: (async (req, res) => {
      await service.removeEvaluation(
        owner(req),
        parseIdParam(req.params.id, 'Evaluación no encontrada.'),
      );
      res.status(204).end();
    }) satisfies RequestHandler,

    subjectGrades: (async (req, res) => {
      const id = parseIdParam(req.params.id, 'Asignatura no encontrada.');
      res.json(await service.getSubjectGrades(owner(req), id));
    }) satisfies RequestHandler,
  };
}
