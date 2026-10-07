import {
  SCHEDULE_IMPORT_MAX_BYTES,
  SCHEDULE_IMPORT_MESSAGES,
  confirmScheduleImportSchema,
} from '@planner/core';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { z, type ZodError } from 'zod';
import { AppError, validationError } from '../errors/AppError.js';
import { authOf } from '../middleware/requireAuth.js';
import type { ScheduleImportConfirmService } from '../services/scheduleImportConfirmService.js';
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

/**
 * The same envelope as the service's refusals: every invalid class at once in `details.items` (by `clientId`, so the
 * screen knows which card to mark), plus the usual `details.fields`. Only keys and messages are echoed, never values.
 */
function confirmBodyError(error: ZodError, body: unknown) {
  const sent = (body as { classes?: unknown } | undefined)?.classes;
  const items = new Map<
    number,
    {
      clientId: string;
      code: 'VALIDATION_ERROR';
      message: string;
      fields: Record<string, string[]>;
    }
  >();
  for (const issue of error.issues) {
    const i = issue.path[0] === 'classes' ? issue.path[1] : undefined;
    if (typeof i !== 'number') continue;
    const id = Array.isArray(sent)
      ? (sent[i] as { clientId?: unknown } | undefined)?.clientId
      : undefined;
    const item = items.get(i) ?? {
      clientId: typeof id === 'string' ? id.slice(0, 64) : String(i),
      code: 'VALIDATION_ERROR' as const,
      message: 'Revisa los campos marcados.',
      fields: {},
    };
    (item.fields[issue.path.slice(2).join('.') || '_'] ??= []).push(issue.message);
    items.set(i, item);
  }
  return new AppError(
    400,
    'VALIDATION_ERROR',
    'Datos inválidos. Revisa las clases marcadas: no se importó nada.',
    { fields: z.flattenError(error).fieldErrors, items: [...items.values()] },
  );
}

export function createScheduleImportController(
  service: ScheduleImportService,
  confirmService: ScheduleImportConfirmService,
) {
  return {
    /** Creates the reviewed classes (and the new subjects they need) in one transaction; see the service. */
    confirm: (async (req, res) => {
      const parsed = confirmScheduleImportSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw confirmBodyError(parsed.error, req.body);
      const input = parsed.data;
      const { id, timezone } = authOf(req).user;
      res.status(201).json(await confirmService.confirm({ id, timezone }, input));
    }) satisfies RequestHandler,

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
