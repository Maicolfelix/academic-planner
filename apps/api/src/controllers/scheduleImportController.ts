import { SCHEDULE_IMPORT_MAX_BYTES, SCHEDULE_IMPORT_MESSAGES } from '@planner/core';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError, validationError } from '../errors/AppError.js';
import { authOf } from '../middleware/requireAuth.js';
import type { ScheduleImportService } from '../services/scheduleImportService.js';

/**
 * Multipart with ONE file in the field `file` and nothing else. The file is held in memory (never written to
 * disk, so there is no temp file to clean up and no path to traverse); its size is capped while it streams in,
 * so an oversized upload is cut off instead of being buffered whole.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SCHEDULE_IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 2 },
}).single('file');

const NO_FILE = validationError({ file: ['Selecciona un archivo de imagen o PDF.'] });

export function createScheduleImportController(service: ScheduleImportService) {
  return {
    parse: ((req, res, next) => {
      upload(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          return next(
            err.code === 'LIMIT_FILE_SIZE'
              ? new AppError(413, 'FILE_TOO_LARGE', SCHEDULE_IMPORT_MESSAGES.TOO_LARGE)
              : NO_FILE,
          );
        }
        if (err) return next(err);
        if (!req.file) return next(NO_FILE);

        const { id, timezone } = authOf(req).user;
        // Depends on the user's data and the clock: never cache it.
        res.set('Cache-Control', 'no-store');
        service
          .parse(
            { id, timezone },
            {
              buffer: req.file.buffer,
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
            },
          )
          .then((result) => res.json(result), next);
      });
    }) satisfies RequestHandler,
  };
}
