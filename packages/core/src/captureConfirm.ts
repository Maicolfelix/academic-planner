import { z } from 'zod';
import { dateOnlySchema, subjectNameSchema, subjectSchema, type DateOnly } from './academic.js';
import { weekdayOf } from './calendar.js';
import { activitySchema, createActivitySchema, dueTimeSchema } from './activity.js';
import { CAPTURE_MAX_BLOCKS, CAPTURE_MAX_PROPOSALS } from './captureProposals.js';
import { CAPTURE_EVALUATION_ACTIONS, GRADE_CAPTURE_MAX } from './captureGrades.js';
import { createEvaluationSchema, evaluationSchema } from './grading.js';
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

/**
 * One grade action the student confirmed (B3). The client says WHAT to apply to WHICH of the student's own things; everything
 * the server can derive is the server's (the owner, the period, a generated name for a direct cut grade). Four actions:
 *  - SET_CUT_GRADE: the grade of a whole cut of a subject (no name, no weight);
 *  - UPDATE_CUT_GRADE: change that grade — `expectScoreMilli` is the grade the student SAW, so a newer one is never overwritten;
 *  - SCORE_EVALUATION: the score of an existing PENDING evaluation (`expectScoreMilli` is null: still pending when confirmed);
 *  - CREATE_EVALUATION: a new pending evaluation in a cut, optionally linked to an activity of this same request.
 */
export const captureConfirmEvaluationSchema = z
  .strictObject({
    /** Chosen by the client so an error can be pointed at the card it came from. Never stored. */
    clientId: z.string().min(1).max(64),
    action: z.enum(CAPTURE_EVALUATION_ACTIONS),
    subjectId: z.uuid('Asignatura inválida.'),
    gradingPeriodId: z.uuid().optional(),
    evaluationId: z.uuid().optional(),
    name: createEvaluationSchema.shape.name,
    periodShareBp: createEvaluationSchema.shape.periodShareBp,
    scoreMilli: createEvaluationSchema.shape.scoreMilli,
    rawEarnedMilli: createEvaluationSchema.shape.rawEarnedMilli,
    rawMaxMilli: createEvaluationSchema.shape.rawMaxMilli,
    expectScoreMilli: z.number().int().nullable().optional(),
    /** The `clientId` of an ITEM of this same request: the evaluation is linked to the activity that item creates. */
    activityClientId: z.string().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    const need = (key: keyof typeof v, message: string) => {
      if (v[key] === undefined || v[key] === null)
        ctx.addIssue({ code: 'custom', path: [key as string], message });
    };
    const forbid = (key: keyof typeof v) => {
      if (v[key] !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: [key as string],
          message: 'No corresponde a esta acción.',
        });
    };
    const noEarned = v.rawEarnedMilli === undefined || v.rawEarnedMilli === null;
    const noMax = v.rawMaxMilli === undefined || v.rawMaxMilli === null;
    if (noEarned !== noMax)
      ctx.addIssue({
        code: 'custom',
        path: ['rawMaxMilli'],
        message: 'Indica lo obtenido y el máximo juntos.',
      });
    if (
      typeof v.rawEarnedMilli === 'number' &&
      typeof v.rawMaxMilli === 'number' &&
      (v.rawMaxMilli <= 0 || v.rawEarnedMilli > v.rawMaxMilli)
    )
      ctx.addIssue({ code: 'custom', path: ['rawEarnedMilli'], message: 'Puntos no válidos.' });
    if (v.action === 'SET_CUT_GRADE') {
      need('gradingPeriodId', 'Falta el corte.');
      need('scoreMilli', 'Falta la nota.');
      for (const k of [
        'evaluationId',
        'name',
        'periodShareBp',
        'expectScoreMilli',
        'activityClientId',
      ] as const)
        forbid(k);
    } else if (v.action === 'UPDATE_CUT_GRADE' || v.action === 'SCORE_EVALUATION') {
      need('evaluationId', 'Falta la evaluación.');
      need('scoreMilli', 'Falta la nota.');
      if (v.expectScoreMilli === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['expectScoreMilli'],
          message: 'Falta la nota que viste.',
        });
      if (v.action === 'UPDATE_CUT_GRADE' && v.expectScoreMilli === null)
        ctx.addIssue({
          code: 'custom',
          path: ['expectScoreMilli'],
          message: 'Falta la nota que viste.',
        });
      if (v.action === 'SCORE_EVALUATION' && typeof v.expectScoreMilli === 'number')
        ctx.addIssue({
          code: 'custom',
          path: ['expectScoreMilli'],
          message: 'La evaluación debe estar pendiente.',
        });
      for (const k of ['gradingPeriodId', 'name', 'periodShareBp', 'activityClientId'] as const)
        forbid(k);
    } else {
      need('gradingPeriodId', 'Falta el corte.');
      need('name', 'Falta el nombre.');
      need('periodShareBp', 'Falta el peso.');
      for (const k of ['evaluationId', 'expectScoreMilli'] as const) forbid(k);
      // A new evaluation may come already scored (the grades rules apply on the server).
      if (v.rawEarnedMilli != null && v.scoreMilli == null)
        ctx.addIssue({ code: 'custom', path: ['scoreMilli'], message: 'Falta la nota.' });
    }
  });
export type CaptureConfirmEvaluation = z.infer<typeof captureConfirmEvaluationSchema>;

export const captureConfirmSchema = z
  .strictObject({
    items: z.array(captureConfirmItemSchema).max(CAPTURE_MAX_PROPOSALS).default([]),
    /** The weekly schedules of the capture, one block per weekday. */
    blocks: z.array(captureConfirmBlockSchema).max(CAPTURE_MAX_BLOCKS).default([]),
    /** The grade actions of the capture (scores, cut grades, new evaluations). */
    evaluations: z.array(captureConfirmEvaluationSchema).max(GRADE_CAPTURE_MAX).default([]),
  })
  .refine((v) => v.items.length + v.blocks.length + v.evaluations.length > 0, {
    path: ['items'],
    message: 'Selecciona al menos una actividad, un horario o una nota.',
  })
  .refine((v) => new Set(v.items.map((i) => i.clientId)).size === v.items.length, {
    path: ['items'],
    message: 'Hay actividades repetidas en la solicitud.',
  })
  .refine(
    (v) =>
      new Set([...v.items, ...v.blocks, ...v.evaluations].map((i) => i.clientId)).size ===
      v.items.length + v.blocks.length + v.evaluations.length,
    { path: ['blocks'], message: 'Hay elementos repetidos en la solicitud.' },
  )
  .refine(
    (v) =>
      v.evaluations.every(
        (e) =>
          e.activityClientId === undefined ||
          v.items.some((i) => i.clientId === e.activityClientId),
      ),
    { path: ['evaluations'], message: 'La actividad enlazada no está en la solicitud.' },
  );
export type CaptureConfirmInput = z.infer<typeof captureConfirmSchema>;
/** What the client builds: both lists are always sent (the server defaults a missing one to empty). */
export type CaptureConfirmRequest = z.input<typeof captureConfirmSchema> & {
  items: z.input<typeof captureConfirmItemSchema>[];
  blocks: z.input<typeof captureConfirmBlockSchema>[];
  evaluations?: z.input<typeof captureConfirmEvaluationSchema>[];
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
  /** The grade actions applied, in the order of the request (a created or an updated evaluation). */
  evaluations: z
    .array(
      z.object({
        clientId: z.string(),
        action: z.enum(CAPTURE_EVALUATION_ACTIONS),
        evaluation: evaluationSchema,
      }),
    )
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
  'EVALUATION_CONFLICT',
  'STALE_EVALUATION',
  'DUPLICATE_EVALUATION',
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
  EVALUATION_CONFLICT:
    'Algo cambió en tus notas desde que lo viste. Revisa lo marcado: no se creó nada.',
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
