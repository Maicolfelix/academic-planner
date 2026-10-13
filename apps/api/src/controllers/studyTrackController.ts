import { createStudyTrackSchema, updateStudyTrackSchema } from '@planner/core';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { parseIdParam } from '../http/params.js';
import { authOf } from '../middleware/requireAuth.js';
import type { StudyTrackService } from '../services/studyTrackService.js';

const NOT_FOUND = 'Estudio no encontrado.';

/** The actions (make primary, archive, restore) take no data: anything in the body is refused, never silently ignored. */
const noBody = z.strictObject({});

/** Thin HTTP layer: validate input, take the owner from the session ONLY, delegate. There is deliberately no DELETE. */
export function createStudyTrackController(service: StudyTrackService) {
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
