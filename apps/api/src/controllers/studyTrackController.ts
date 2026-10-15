import {
  adoptPeriodSchema,
  createStudyTrackSchema,
  setupStudyTrackSchema,
  updateStudyTrackSchema,
} from '@planner/core';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { StudySetupService } from '../services/studySetupService.js';
import type { StudyTrackService } from '../services/studyTrackService.js';

const NOT_FOUND = 'Estudio no encontrado.';

/** The actions (make primary, archive, restore) take no data: anything in the body is refused, never silently ignored. */
const noBody = z.strictObject({});

/** Thin HTTP layer: validate input, take the owner from the session ONLY, delegate. There is deliberately no DELETE. */
export function createStudyTrackController(service: StudyTrackService, setup: StudySetupService) {
  const owner = (req: Parameters<RequestHandler>[0]) => authOf(req).user.id;
  const action = (run: (userId: string, id: string) => ReturnType<StudyTrackService['archive']>) =>
    (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      noBody.parse(req.body ?? {});
      res.json({ studyTracks: await run(owner(req), id) });
    }) satisfies RequestHandler;

  return {
    list: (async (req, res) => {
      res.json({ studyTracks: await service.list(owner(req)) });
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const input = createStudyTrackSchema.parse(req.body ?? {});
      res.status(201).json({ studyTrack: await service.create(owner(req), input) });
    }) satisfies RequestHandler,

    /** A study + its first period + (optionally) its first subjects, all or nothing. The body is strict at every level. */
    setup: (async (req, res) => {
      const input = setupStudyTrackSchema.parse(req.body ?? {});
      res.status(201).json(await setup.setup(owner(req), input));
    }) satisfies RequestHandler,

    /** A new study that takes over an existing period of the user that belongs to no study (nothing is copied). */
    adoptPeriod: (async (req, res) => {
      const input = adoptPeriodSchema.parse(req.body ?? {});
      res.status(201).json(await setup.adoptPeriod(owner(req), input));
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const id = parseIdParam(req.params.id, NOT_FOUND);
      const input = updateStudyTrackSchema.parse(req.body ?? {});
      res.json({ studyTrack: await service.update(owner(req), id, input) });
    }) satisfies RequestHandler,

    makePrimary: action((userId, id) => service.makePrimary(userId, id)),
    archive: action((userId, id) => service.archive(userId, id)),
    restore: action((userId, id) => service.restore(userId, id)),
  };
}
