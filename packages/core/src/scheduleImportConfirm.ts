import { z } from 'zod';
import {
  dateOnlySchema,
  findSubjectByName,
  normalizeNameKey,
  pickSubjectColor,
  subjectNameSchema,
  subjectSchema,
  type DateOnly,
  type SubjectColor,
} from './academic.js';
import { dueTimeSchema } from './activity.js';
import { firstWeekdayOnOrAfter, type Weekday } from './calendar.js';
import {
  SCHEDULE_TITLE_MAX,
  scheduleBlockSchema,
  type CreateScheduleBlockRequest,
} from './schedule.js';
import { SCHEDULE_IMPORT_MAX_PROPOSALS } from './scheduleImport.js';

/**
 * Schedule import, the CONFIRMATION half. The student has reviewed the proposals; this is what the client sends to
 * create them in ONE operation: the classes and, for those whose subject does not exist yet, the subject itself.
 *
 * Nothing the server can derive is accepted: no user, period, name key, color or timestamps (`strict` rejects them).
 * The subject of each class is either one of the student's own (`EXISTING`) or a new one by name (`NEW`).
 */

const title = z
  .string({ error: 'Ingresa un título.' })
  .trim()
  .min(1, 'Ingresa un título.')
  .max(
    SCHEDULE_TITLE_MAX,
    `El título es demasiado largo (máximo ${SCHEDULE_TITLE_MAX} caracteres).`,
  );

export const importSubjectChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('EXISTING'), subjectId: z.uuid('Asignatura inválida.') }),
  z.strictObject({ kind: z.literal('NEW'), name: subjectNameSchema }),
]);

export const confirmImportClassSchema = z
  .strictObject({
    /** Chosen by the client so an error can be pointed at the card it came from. Never stored. */
    clientId: z.string().min(1).max(64),
    /** ISO weekday, 1 = Monday. The first date of the series is derived from it and the period. */
    weekday: z.number().int().min(1).max(7),
    startTime: dueTimeSchema,
    endTime: dueTimeSchema,
    title,
    /** Last day of the weekly repetition. */
    until: dateOnlySchema,
    subject: importSubjectChoiceSchema,
  })
  .refine((v) => v.endTime > v.startTime, {
    path: ['endTime'],
    message: 'La hora de fin debe ser posterior a la de inicio.',
  });

export const confirmScheduleImportSchema = z
  .strictObject({
    classes: z
      .array(confirmImportClassSchema)
      .min(1, 'Selecciona al menos una clase.')
      .max(SCHEDULE_IMPORT_MAX_PROPOSALS),
  })
  .refine((v) => new Set(v.classes.map((c) => c.clientId)).size === v.classes.length, {
    path: ['classes'],
    message: 'Hay clases repetidas en la solicitud.',
  });

export type ConfirmImportClass = z.infer<typeof confirmImportClassSchema>;
export type ConfirmScheduleImportInput = z.infer<typeof confirmScheduleImportSchema>;
export type ConfirmScheduleImportRequest = z.input<typeof confirmScheduleImportSchema>;

export const confirmScheduleImportResponseSchema = z.object({
  /** Subjects that did not exist and were created by this confirmation. */
  createdSubjects: z.array(subjectSchema),
  /** Subjects of the student that the imported classes were attached to. */
  reusedSubjects: z.array(z.object({ id: z.uuid(), name: z.string() })),
  createdBlocks: z.array(z.object({ clientId: z.string(), block: scheduleBlockSchema })),
});
export type ConfirmScheduleImportResponse = z.infer<typeof confirmScheduleImportResponseSchema>;

/** What `details.items` of a refused confirmation says about each class that could not be imported. */
export const confirmImportItemErrorSchema = z.object({
  clientId: z.string(),
  code: z.enum(['VALIDATION_ERROR', 'DUPLICATE_CLASS']),
  message: z.string(),
  fields: z.record(z.string(), z.array(z.string())),
});
export type ConfirmImportItemError = z.infer<typeof confirmImportItemErrorSchema>;

export const DUPLICATE_CLASS_MESSAGE = 'Esta clase ya está en tu agenda.';

// ───────────────────────── Resolving subjects ─────────────────────────

export interface ExistingSubjectRef {
  id: string;
  name: string;
  color: string;
}

export interface NewSubjectPlan {
  /** `normalizeNameKey` of the name: what the database compares. */
  key: string;
  name: string;
  color: SubjectColor;
}

export type ImportSubjectTarget =
  { kind: 'EXISTING'; subjectId: string } | { kind: 'NEW'; key: string };

export interface ImportSubjectPlan {
  toCreate: NewSubjectPlan[];
  /** In request order: where each class goes. */
  targets: { clientId: string; target: ImportSubjectTarget }[];
}

/**
 * Which subjects the classes need. Pure: it compares names with the SAME normalisation the database uses (no fuzzy
 * merging: "Proyecto II" and "Proyectos II" are two subjects unless the student wrote one name). A class that asks for
 * a NEW subject whose name already exists in the period reuses that subject; several classes naming the same new
 * subject share one. The name kept is the one typed first; colors are the palette's unused ones, in order.
 */
export function planImportSubjects(
  classes: readonly Pick<ConfirmImportClass, 'clientId' | 'subject'>[],
  existing: readonly ExistingSubjectRef[],
): ImportSubjectPlan {
  const toCreate: NewSubjectPlan[] = [];
  const colors = existing.map((s) => s.color);

  const targets = classes.map(({ clientId, subject }) => {
    if (subject.kind === 'EXISTING') {
      return { clientId, target: { kind: 'EXISTING', subjectId: subject.subjectId } as const };
    }
    const key = normalizeNameKey(subject.name);
    const found = findSubjectByName(subject.name, existing);
    if (found) return { clientId, target: { kind: 'EXISTING', subjectId: found.id } as const };
    if (!toCreate.some((n) => n.key === key)) {
      const color = pickSubjectColor(colors);
      colors.push(color);
      toCreate.push({ key, name: subject.name, color });
    }
    return { clientId, target: { kind: 'NEW', key } as const };
  });
  return { toCreate, targets };
}

/** The body the Schedule service takes for one confirmed class (the same one the manual form sends). */
export function toScheduleBlockInput(
  c: Pick<ConfirmImportClass, 'weekday' | 'startTime' | 'endTime' | 'title' | 'until'>,
  subjectId: string,
  periodStart: DateOnly,
): CreateScheduleBlockRequest {
  return {
    type: 'CLASS',
    subjectId,
    title: c.title,
    date: firstWeekdayOnOrAfter(periodStart, c.weekday as Weekday),
    startTime: c.startTime,
    endTime: c.endTime,
    recurrence: { frequency: 'WEEKLY', until: c.until },
  };
}
