import { z } from 'zod';
import { dateOnlySchema, subjectNameSchema, subjectSchema, type DateOnly } from './academic.js';
import { weekdayOf } from './calendar.js';
import { activitySchema, createActivitySchema, dueTimeSchema } from './activity.js';
import { CAPTURE_MAX_BLOCKS, CAPTURE_MAX_PROPOSALS } from './captureProposals.js';
import { SCHEDULE_TITLE_MAX, scheduleBlockSchema } from './schedule.js';
import type { ExistingClass } from './scheduleImport.js';
import { toLocalParts } from './time.js';

/**
 * Capture, the CONFIRMATION half. The student has seen the proposals of one text and ticked the ones to keep; this is what
 * the client sends to create them ALL in one operation: the activities and, for the ones whose subject does not exist
 * yet, the subject itself. Everything or nothing is saved.
 *
 * Nothing the server can derive is accepted: no user, no period (an activity takes its subject's period, or the current
 * one when it has none), no reminders, no status, no name key or color. `strict` rejects them. The fields of each
 * activity are EXACTLY the ones of `POST /api/activities`, so there is one rule for what an activity is.
 *
 * The subject of each item is `NONE` (a general activity: valid, not a gap), one of the student's own (`EXISTING`) or a new
 * one by name (`NEW`); several items that name the same new subject create it once.
 */

export const captureConfirmSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('NONE') }),
  z.strictObject({ kind: z.literal('EXISTING'), subjectId: z.uuid('Asignatura inválida.') }),
  z.strictObject({ kind: z.literal('NEW'), name: subjectNameSchema }),
]);
export type CaptureConfirmSubject = z.infer<typeof captureConfirmSubjectSchema>;

export const captureConfirmItemSchema = createActivitySchema.omit({ subjectId: true }).extend({
  /** Chosen by the client so an error can be pointed at the card it came from. Never stored. */
  clientId: z.string().min(1).max(64),
  subject: captureConfirmSubjectSchema,
  /**
   * The student saw that an activity just like this one already exists and wants it anyway. Without it the server refuses
   * an exact copy of an existing activity (same title, type, subject and deadline): that is also what protects a retry or
   * a double tap from creating everything twice.
   */
  allowDuplicate: z.boolean().optional(),
});
export type CaptureConfirmItem = z.infer<typeof captureConfirmItemSchema>;

/**
 * One weekly ScheduleBlock the student confirmed (a slot of a recurrence suggestion): a weekday, the two times, the
 * subject. The first date of the series, the period and the last day of the repetition (the period's end, unless `until`
 * is given and fits) are derived by the SERVER: the client never says which period, and a block is only ever created in
 * the current one. A CLASS needs a subject; a STUDY session may have none (`NONE`).
 */
export const captureConfirmBlockSchema = z
  .strictObject({
    /** Chosen by the client so an error can be pointed at the card it came from. Never stored. */
    clientId: z.string().min(1).max(64),
    type: z.enum(['CLASS', 'STUDY']),
    title: z
      .string({ error: 'Ingresa un título.' })
      .trim()
      .min(1, 'Ingresa un título.')
      .max(
        SCHEDULE_TITLE_MAX,
        `El título es demasiado largo (máximo ${SCHEDULE_TITLE_MAX} caracteres).`,
      )
      // PostgreSQL text cannot hold a NUL: a clear 400 here, never a 500 later.
      .refine((v) => !v.includes('\u0000'), 'El título contiene un carácter no válido.'),
    /** ISO weekday, 1 = Monday. */
    weekday: z.number().int().min(1).max(7),
    startTime: dueTimeSchema,
    endTime: dueTimeSchema,
    subject: captureConfirmSubjectSchema,
    /** Last day of the weekly repetition. Omitted: the end of the current period. */
    until: dateOnlySchema.optional(),
  })
  .refine((v) => v.endTime > v.startTime, {
    path: ['endTime'],
    message: 'La hora de fin debe ser posterior a la de inicio.',
  });
export type CaptureConfirmBlock = z.infer<typeof captureConfirmBlockSchema>;

export const captureConfirmSchema = z
  .strictObject({
    items: z.array(captureConfirmItemSchema).max(CAPTURE_MAX_PROPOSALS).default([]),
    /** The weekly schedules of the capture, one block per weekday. */
    blocks: z.array(captureConfirmBlockSchema).max(CAPTURE_MAX_BLOCKS).default([]),
  })
  .refine((v) => v.items.length + v.blocks.length > 0, {
    path: ['items'],
    message: 'Selecciona al menos una actividad o un horario.',
  })
  .refine((v) => new Set(v.items.map((i) => i.clientId)).size === v.items.length, {
    path: ['items'],
    message: 'Hay actividades repetidas en la solicitud.',
  })
  .refine(
    (v) =>
      new Set([...v.items, ...v.blocks].map((i) => i.clientId)).size ===
      v.items.length + v.blocks.length,
    { path: ['blocks'], message: 'Hay elementos repetidos en la solicitud.' },
  );
export type CaptureConfirmInput = z.infer<typeof captureConfirmSchema>;
/** What the client builds: both lists are always sent (the server defaults a missing one to empty). */
export type CaptureConfirmRequest = z.input<typeof captureConfirmSchema> & {
  items: z.input<typeof captureConfirmItemSchema>[];
  blocks: z.input<typeof captureConfirmBlockSchema>[];
};

export const captureConfirmResponseSchema = z.object({
  /** In the order of the request. */
  createdActivities: z.array(z.object({ clientId: z.string(), activity: activitySchema })),
  /** Subjects that did not exist and were created by this confirmation. */
  createdSubjects: z.array(subjectSchema),
  /** The student's subjects that already existed and were used (including a new name that matched one). */
  reusedSubjects: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** The activities created. */
  count: z.number().int().nonnegative(),
  /** The weekly blocks created, in the order of the request. */
  createdBlocks: z
    .array(z.object({ clientId: z.string(), block: scheduleBlockSchema }))
    .default([]),
  /** A block that is already in the agenda (same subject, weekday and times): it is reused, never duplicated. */
  reusedBlocks: z
    .array(z.object({ clientId: z.string(), id: z.uuid(), title: z.string() }))
    .default([]),
});
export type CaptureConfirmResponse = z.infer<typeof captureConfirmResponseSchema>;

/** Why one item was refused. The whole confirmation is then rolled back: no item of the request is saved. */
export const CAPTURE_CONFIRM_ITEM_CODES = [
  'VALIDATION_ERROR',
  'SUBJECT_NOT_FOUND',
  'DUPLICATE_ACTIVITY',
] as const;
export const captureConfirmItemErrorSchema = z.object({
  clientId: z.string(),
  code: z.enum(CAPTURE_CONFIRM_ITEM_CODES),
  message: z.string(),
  fields: z.record(z.string(), z.array(z.string())),
});
export type CaptureConfirmItemError = z.infer<typeof captureConfirmItemErrorSchema>;

export const CAPTURE_CONFIRM_MESSAGES = {
  DUPLICATE_ACTIVITY: 'Ya tienes una actividad igual con la misma fecha. No se creó nada.',
  REJECTED: 'Revisa lo marcado: no se creó nada.',
  IN_PROGRESS: 'Ya estamos creando actividades tuyas. Espera a que termine e inténtalo de nuevo.',
} as const;

/**
 * "This weekly block is already in the agenda": the same type and subject (none for none), the same weekday, the same start
 * and end time, a weekly series whose dates overlap the new one's. It is REUSED, never duplicated (the class importer asks
 * the same of a class; here a study session counts too). A single block that merely happens that day is not a series.
 */
export function findDuplicateBlock(
  wanted: {
    type: string;
    subjectId: string | null;
    weekday: number;
    startTime: string;
    endTime: string;
    range: { from: DateOnly; until: DateOnly };
  },
  existing: readonly ExistingClass[],
  timeZone: string,
): ExistingClass | undefined {
  return existing.find((e) => {
    if (!e.recurring || e.type !== wanted.type || e.subjectId !== wanted.subjectId) return false;
    const start = toLocalParts(e.startAt, timeZone);
    const end = toLocalParts(e.endAt, timeZone);
    if (
      weekdayOf(start.date) !== wanted.weekday ||
      start.time !== wanted.startTime ||
      end.time !== wanted.endTime
    ) {
      return false;
    }
    if (!e.until) return true;
    return start.date <= wanted.range.until && wanted.range.from <= e.until;
  });
}
