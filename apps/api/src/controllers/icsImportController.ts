import {
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_MESSAGES,
  confirmIcsImportSchema,
  type IcsItemError,
} from '@planner/core';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { z, type ZodError } from 'zod';
import { AppError, validationError } from '../errors/AppError.js';
import { authOf } from '../middleware/requireAuth.js';
import type { IcsImportConfirmService } from '../services/icsImportConfirmService.js';
import type { IcsImportService } from '../services/icsImportService.js';

/**
 * Multipart with ONE file in the field `file` and nothing else. The file is held in memory (never written to disk, so there is no
 * temp file to clean up and no path to traverse) and its size is capped while it streams in.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ICS_IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 2 },
}).single('file');

const NO_FILE = validationError({ file: [ICS_IMPORT_MESSAGES.NO_FILE] });

/** Every invalid item at once, by its `clientId`, so the screen knows which card to mark. Only keys and messages are echoed. */
function confirmBodyError(error: ZodError, body: unknown) {
  const sent = (body as { items?: unknown } | undefined)?.items;
  const items = new Map<number, IcsItemError>();
  for (const issue of error.issues) {
    const i = issue.path[0] === 'items' ? issue.path[1] : undefined;
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
    'Datos inválidos. Revisa los eventos marcados: no se importó nada.',
    {
      fields: z.flattenError(error).fieldErrors,
      items: [...items.values()],
    },
  );
}

export function createIcsImportController(
  service: IcsImportService,
  confirmService: IcsImportConfirmService,
) {
  return {
    /** Creates the reviewed activities and classes in one transaction; see the service. */
    confirm: (async (req, res) => {
      const parsed = confirmIcsImportSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw confirmBodyError(parsed.error, req.body);
      const { id, timezone } = authOf(req).user;
      res.status(201).json(await confirmService.confirm({ id, timezone }, parsed.data));
    }) satisfies RequestHandler,

    parse: ((req, res, next) => {
      upload(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          return next(
            err.code === 'LIMIT_FILE_SIZE'
              ? new AppError(413, 'FILE_TOO_LARGE', ICS_IMPORT_MESSAGES.TOO_LARGE)
              : NO_FILE,
          );
        }
        if (err) return next(err);
        if (!req.file) return next(NO_FILE);
        const { id, timezone } = authOf(req).user;
        service
          .parse({ id, timezone }, { buffer: req.file.buffer, originalname: req.file.originalname })
          .then((result) => res.json(result), next);
      });
    }) satisfies RequestHandler,
  };
}
