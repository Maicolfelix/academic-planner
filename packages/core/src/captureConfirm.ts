import { z } from 'zod';
import { subjectNameSchema, subjectSchema } from './academic.js';
import { activitySchema, createActivitySchema } from './activity.js';
import { CAPTURE_MAX_PROPOSALS } from './captureProposals.js';

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

export const captureConfirmSchema = z
  .strictObject({
    items: z
      .array(captureConfirmItemSchema)
      .min(1, 'Selecciona al menos una actividad.')
      .max(CAPTURE_MAX_PROPOSALS),
  })
  .refine((v) => new Set(v.items.map((i) => i.clientId)).size === v.items.length, {
    path: ['items'],
    message: 'Hay actividades repetidas en la solicitud.',
  });
export type CaptureConfirmInput = z.infer<typeof captureConfirmSchema>;
export type CaptureConfirmRequest = z.input<typeof captureConfirmSchema>;

export const captureConfirmResponseSchema = z.object({
  /** In the order of the request. */
  createdActivities: z.array(z.object({ clientId: z.string(), activity: activitySchema })),
  /** Subjects that did not exist and were created by this confirmation. */
  createdSubjects: z.array(subjectSchema),
  /** The student's subjects that already existed and were used (including a new name that matched one). */
  reusedSubjects: z.array(z.object({ id: z.uuid(), name: z.string() })),
  count: z.number().int().nonnegative(),
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
  REJECTED: 'Revisa las actividades marcadas: no se creó nada.',
  IN_PROGRESS: 'Ya estamos creando actividades tuyas. Espera a que termine e inténtalo de nuevo.',
} as const;
