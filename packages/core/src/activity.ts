import { z } from 'zod';
import { dateOnlySchema, isRealDateOnly } from './academic.js';

// ───────────────────────── Enums (value + Spanish label) ─────────────────────────

export const ACTIVITY_TYPES = [
  'TASK',
  'EXAM',
  'QUIZ',
  'PROJECT',
  'PRESENTATION',
  'WORKSHOP',
  'READING',
  'OTHER',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  TASK: 'Tarea',
  EXAM: 'Parcial',
  QUIZ: 'Quiz',
  PROJECT: 'Proyecto',
  PRESENTATION: 'Exposición',
  WORKSHOP: 'Taller',
  READING: 'Lectura',
  OTHER: 'Otro',
};

export const ACTIVITY_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];
export const ACTIVITY_PRIORITY_LABELS: Record<ActivityPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
};

export const ACTIVITY_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En proceso',
  COMPLETED: 'Finalizada',
};

/** Quick creation never asks for these: most activities are plain tasks of normal importance. */
export const DEFAULT_ACTIVITY_TYPE: ActivityType = 'TASK';
export const DEFAULT_ACTIVITY_PRIORITY: ActivityPriority = 'MEDIUM';

// ───────────────────────── Pure rules ─────────────────────────

/**
 * Overdue is DERIVED, never stored: the deadline has passed and the activity is not finished.
 * Strict `<`: at the exact deadline instant it is not overdue yet. `now` is always injected.
 */
export function isOverdue(
  activity: { dueAt: Date | string; status: ActivityStatus },
  now: Date,
): boolean {
  return activity.status !== 'COMPLETED' && new Date(activity.dueAt).getTime() < now.getTime();
}

/**
 * completedAt follows the status, decided here and never by the client:
 *  - becoming COMPLETED stamps `now`;
 *  - staying COMPLETED keeps the original stamp (re-saving does not move it);
 *  - leaving COMPLETED clears it.
 */
export function resolveCompletedAt(
  previous: { status: ActivityStatus; completedAt: Date | null },
  nextStatus: ActivityStatus,
  now: Date,
): Date | null {
  if (nextStatus !== 'COMPLETED') return null;
  if (previous.status === 'COMPLETED' && previous.completedAt) return previous.completedAt;
  return now;
}

// ───────────────────────── Input schemas ─────────────────────────

export const ACTIVITY_TITLE_MAX = 150;
export const ACTIVITY_DESCRIPTION_MAX = 2000;

export const dueTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ingresa una hora válida (HH:mm).');

const title = z
  .string({ error: 'Ingresa un título.' })
  .trim()
  .min(1, 'Ingresa un título.')
  .max(
    ACTIVITY_TITLE_MAX,
    `El título es demasiado largo (máximo ${ACTIVITY_TITLE_MAX} caracteres).`,
  );

const description = z
  .string()
  .trim()
  .max(
    ACTIVITY_DESCRIPTION_MAX,
    `La descripción es demasiado larga (máximo ${ACTIVITY_DESCRIPTION_MAX} caracteres).`,
  )
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

/** '' and null both mean "no time" (the activity is due at the end of the day). */
const optionalTime = z
  .union([dueTimeSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' || v === null ? null : v));

const enumField = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.enum(values, { error: message });

const uuid = (message: string) => z.uuid(message);

/**
 * The owner is never part of the input (session only) and neither is the status: a new activity
 * is always PENDING. `strict` rejects any unknown key such as a client-sent userId.
 */
export const createActivitySchema = z.strictObject({
  subjectId: uuid('Elige una asignatura.'),
  title,
  dueDate: dateOnlySchema,
  dueTime: optionalTime,
  type: enumField(ACTIVITY_TYPES, 'Tipo inválido.').default(DEFAULT_ACTIVITY_TYPE),
  priority: enumField(ACTIVITY_PRIORITIES, 'Prioridad inválida.').default(
    DEFAULT_ACTIVITY_PRIORITY,
  ),
  description,
});

/**
 * `dueTime: null` removes the time (back to end of day); omitting both dueDate and dueTime leaves
 * the deadline untouched; sending only one keeps the stored value of the other.
 */
export const updateActivitySchema = z.strictObject({
  subjectId: uuid('Elige una asignatura.').optional(),
  title: title.optional(),
  dueDate: dateOnlySchema.optional(),
  dueTime: optionalTime,
  type: enumField(ACTIVITY_TYPES, 'Tipo inválido.').optional(),
  priority: enumField(ACTIVITY_PRIORITIES, 'Prioridad inválida.').optional(),
  status: enumField(ACTIVITY_STATUSES, 'Estado inválido.').optional(),
  description,
});

const optionalBool = z
  .enum(['true', 'false'], { error: 'Debe ser true o false.' })
  .transform((v) => v === 'true');

const optionalDay = z.string().refine(isRealDateOnly, 'Ingresa una fecha válida.');

/** Query string of GET /api/activities. All filters are optional and combine with AND. */
export const listActivitiesQuerySchema = z
  .object({
    subjectId: uuid('Asignatura inválida.').optional(),
    /** Derived through the subject: activities do not store their period. */
    periodId: uuid('Periodo inválido.').optional(),
    status: enumField(ACTIVITY_STATUSES, 'Estado inválido.').optional(),
    priority: enumField(ACTIVITY_PRIORITIES, 'Prioridad inválida.').optional(),
    type: enumField(ACTIVITY_TYPES, 'Tipo inválido.').optional(),
    overdue: optionalBool.optional(),
    /** Inclusive local days of the user: from 00:00 of `from` to 23:59:59.999 of `to`. */
    from: optionalDay.optional(),
    to: optionalDay.optional(),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, {
    path: ['to'],
    message: 'La fecha "hasta" no puede ser anterior a "desde".',
  });

// ───────────────────────── Response schemas ─────────────────────────

export const activitySchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(ACTIVITY_TYPES),
  priority: z.enum(ACTIVITY_PRIORITIES),
  status: z.enum(ACTIVITY_STATUSES),
  dueAt: z.iso.datetime(),
  hasTime: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const activityResponseSchema = z.object({ activity: activitySchema });
export const activityListResponseSchema = z.object({ activities: z.array(activitySchema) });

export type Activity = z.infer<typeof activitySchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
/** What a client may send: every field optional (the parsed output type has them all resolved). */
export type UpdateActivityRequest = z.input<typeof updateActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
