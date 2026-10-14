import { z } from 'zod';

// ───────────────────────── Dates (calendar days, never instants) ─────────────────────────

/** "YYYY-MM-DD". Compared as strings (ISO order == chronological order); never turned into a Date for display. */
export type DateOnly = string;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDateOnly(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2000 || year > 2100) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export const dateOnlySchema = z
  .string({ error: 'Ingresa una fecha.' })
  .refine(isRealDateOnly, 'Ingresa una fecha válida.');

export const isEndAfterStart = (start: DateOnly, end: DateOnly): boolean => end > start;

/** "2026-08-03" -> "03/08/2026" by string slicing, so no timezone can shift the day. */
export function formatDateOnly(value: DateOnly): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

const END_AFTER_START_MESSAGE = 'La fecha de fin debe ser posterior a la de inicio.';

// ───────────────────────── Names ─────────────────────────

/**
 * Representation used ONLY to compare names: lowercase, no accents, collapsed whitespace.
 * "Redes", " redes " and "REDES", or "Matemáticas" and "matematicas", are the same subject.
 */
export const normalizeNameKey = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The subject (of the given list) that has this name once normalised, if any: never by similarity. */
export const findSubjectByName = <T extends { name: string }>(
  name: string,
  subjects: readonly T[],
): T | undefined => {
  const key = normalizeNameKey(name);
  return subjects.find((s) => normalizeNameKey(s.name) === key);
};

/**
 * A NUL character is not valid text for the database: it would be answered with a 500. Refused where the text enters, with
 * a clear message, by every free-text field (names, titles, descriptions).
 */
export const hasNoNul = (value: string): boolean => !value.includes('\u0000');
export const INVALID_CHARACTERS = 'El texto tiene caracteres no válidos.';

/** Optional text: '' and null both mean "no value"; undefined means "not provided" (PATCH). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} es demasiado largo (máximo ${max} caracteres).`)
    .refine(hasNoNul, INVALID_CHARACTERS)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const requiredName = (max: number) =>
  z
    .string({ error: 'Ingresa un nombre.' })
    .trim()
    .min(1, 'Ingresa un nombre.')
    .max(max, `El nombre es demasiado largo (máximo ${max} caracteres).`)
    .refine(hasNoNul, INVALID_CHARACTERS);

// ───────────────────────── Academic period ─────────────────────────

export const PERIOD_NAME_MAX = 100;

/**
 * The level the student is at DURING this period: a semester, a school grade, a year of a course. It lives on the period
 * (not on the profile) because it changes with every period: "2026-2, semester 4" then "2027-1, semester 5". The domain only
 * stores it, generically: it never asks what kind of student this is (no "university means 1..10"), so the bounds are only
 * a guard against garbage. The screens will say "semestre" or "grado" and offer 1-10 or "Otro" as they see fit.
 */
export const STUDY_LEVEL_MIN = 1;
export const STUDY_LEVEL_MAX = 99;
export const STUDY_LEVEL_NOTE_MAX = 40;

export const studyLevelSchema = z
  .number({ error: 'Ingresa un nivel válido.' })
  .int('El nivel debe ser un número entero.')
  .min(STUDY_LEVEL_MIN, `El nivel debe estar entre ${STUDY_LEVEL_MIN} y ${STUDY_LEVEL_MAX}.`)
  .max(STUDY_LEVEL_MAX, `El nivel debe estar entre ${STUDY_LEVEL_MIN} y ${STUDY_LEVEL_MAX}.`);

/** Free text for "Otro" (a structure a number does not describe): trimmed; '' and null both mean none. */
const studyLevelNoteSchema = optionalText(STUDY_LEVEL_NOTE_MAX, 'La nota del nivel');

const BOTH_LEVELS_MESSAGE = 'Indica el nivel como número o como texto, no los dos a la vez.';

/** A level is a number OR a note, never both. */
const levelAlternatives = (v: { studyLevel?: number | null; studyLevelNote?: string | null }) =>
  !(v.studyLevel != null && v.studyLevelNote != null);

/** A study (StudyTrack) id: the owner is checked by the server (a foreign or unknown one is the same 404). */
const studyTrackIdSchema = z.uuid('Estudio inválido.');

const periodFields = {
  name: requiredName(PERIOD_NAME_MAX),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
};

/** `strict`: unknown keys (e.g. a client-sent `userId`) are rejected, never trusted or silently used. */
export const createPeriodSchema = z
  .strictObject({
    ...periodFields,
    isCurrent: z.boolean().optional(),
    // The study this period belongs to. Omitted or null: a general period (no study), a permanent and valid state.
    studyTrackId: studyTrackIdSchema.nullish(),
    studyLevel: studyLevelSchema.nullish(),
    studyLevelNote: studyLevelNoteSchema.optional(),
  })
  .refine((v) => isEndAfterStart(v.startDate, v.endDate), {
    path: ['endDate'],
    message: END_AFTER_START_MESSAGE,
  })
  .refine(levelAlternatives, { path: ['studyLevelNote'], message: BOTH_LEVELS_MESSAGE });

/**
 * `isCurrent` can only be set to `true` (to un-mark a period, mark another one): a user never ends up
 * with periods but none current by accident. The start/end pair is re-checked against stored values
 * in the service when only one of them is sent.
 */
export const updatePeriodSchema = z
  .strictObject({
    name: periodFields.name.optional(),
    startDate: periodFields.startDate.optional(),
    endDate: periodFields.endDate.optional(),
    isCurrent: z
      .literal(true, { error: 'Solo se puede marcar un periodo como actual.' })
      .optional(),
    // Moves the period to a study (a uuid) or leaves it general (`null`); not mentioned: unchanged.
    studyTrackId: studyTrackIdSchema.nullish(),
    // `null` clears that field; a value sets it and clears the other one (see `resolveStudyLevel`).
    studyLevel: studyLevelSchema.nullish(),
    studyLevelNote: studyLevelNoteSchema.optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || isEndAfterStart(v.startDate, v.endDate), {
    path: ['endDate'],
    message: END_AFTER_START_MESSAGE,
  })
  .refine(levelAlternatives, { path: ['studyLevelNote'], message: BOTH_LEVELS_MESSAGE });

/**
 * The level a period ends up with after an update. Ergonomic, so a client never has to send two nulls:
 *  - a number sets the level and clears the note; a note sets the note and clears the level;
 *  - `null` clears only that field (clearing the active one leaves both empty);
 *  - not mentioned: unchanged.
 * (The schema already refused a request that carries both a number and a note.)
 */
export function resolveStudyLevel(
  current: { studyLevel: number | null; studyLevelNote: string | null },
  patch: { studyLevel?: number | null; studyLevelNote?: string | null },
): { studyLevel: number | null; studyLevelNote: string | null } {
  let { studyLevel, studyLevelNote } = current;
  if (patch.studyLevel !== undefined) {
    studyLevel = patch.studyLevel;
    if (patch.studyLevel !== null) studyLevelNote = null;
  }
  if (patch.studyLevelNote !== undefined) {
    studyLevelNote = patch.studyLevelNote;
    if (patch.studyLevelNote !== null) studyLevel = null;
  }
  return { studyLevel, studyLevelNote };
}

export const END_AFTER_START_ERROR = END_AFTER_START_MESSAGE;

export const periodSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean(),
  /** The study (formation) this period belongs to; null = a general period, a permanent and valid state. */
  studyTrackId: z.uuid().nullable(),
  /** The level during this period, as a number; null when not given (or when `studyLevelNote` is). */
  studyLevel: z.number().int().nullable(),
  /** The level as free text ("Otro"); null when not given (or when `studyLevel` is). */
  studyLevelNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const periodResponseSchema = z.object({ period: periodSchema });
/**
 * `GET /api/periods/home`: the HOME current period (the general current one; else the primary active study's; else none),
 * decided by the server so no client ever re-implements which study is the primary one. `null` when there is none.
 */
export const homePeriodResponseSchema = z.object({ period: periodSchema.nullable() });
export const periodListResponseSchema = z.object({ periods: z.array(periodSchema) });

export type AcademicPeriod = z.infer<typeof periodSchema>;
export type HomePeriodResponse = z.infer<typeof homePeriodResponseSchema>;
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>;
/** What a client may send on update: every field optional. */
export type UpdatePeriodRequest = z.input<typeof updatePeriodSchema>;

// ───────────────────────── Subject ─────────────────────────

export const SUBJECT_NAME_MAX = 100;
export const SUBJECT_PROFESSOR_MAX = 100;
export const SUBJECT_DESCRIPTION_MAX = 500;

/**
 * Fixed palette instead of free text or a color picker: one click, nothing to validate by eye, and every
 * color is mid-tone so it stays visible on light backgrounds. Colors are only ever shown as a swatch/bar;
 * text always stays dark, so contrast never depends on the chosen color.
 */
export const SUBJECT_COLOR_VALUES = [
  '#3B82F6',
  '#EF4444',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#64748B',
] as const;

export type SubjectColor = (typeof SUBJECT_COLOR_VALUES)[number];

export const SUBJECT_COLOR_NAMES: Record<SubjectColor, string> = {
  '#3B82F6': 'Azul',
  '#EF4444': 'Rojo',
  '#10B981': 'Verde',
  '#F59E0B': 'Ámbar',
  '#8B5CF6': 'Violeta',
  '#EC4899': 'Rosa',
  '#14B8A6': 'Turquesa',
  '#F97316': 'Naranja',
  '#6366F1': 'Índigo',
  '#64748B': 'Gris',
};

export const DEFAULT_SUBJECT_COLOR: SubjectColor = '#3B82F6';

/**
 * The color for a subject the server creates on its own (the schedule import): the first palette color the period
 * does not use yet, so the agenda tells the subjects apart; once the palette is exhausted it starts over.
 */
export function pickSubjectColor(used: readonly string[]): SubjectColor {
  const taken = new Set(used.map((c) => c.toUpperCase()));
  return (
    SUBJECT_COLOR_VALUES.find((c) => !taken.has(c)) ??
    SUBJECT_COLOR_VALUES[used.length % SUBJECT_COLOR_VALUES.length]!
  );
}

export const subjectColorSchema = z
  .string({ error: 'Elige un color de la paleta.' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(SUBJECT_COLOR_VALUES, { error: 'Elige un color de la paleta.' }));

/** The one rule for a subject's name (create, edit and the schedule-import confirmation all use it). */
export const subjectNameSchema = requiredName(SUBJECT_NAME_MAX);

/**
 * What kind of study a subject is: a university course, a school subject, or another structured course (languages, a
 * technical program...). There is NO personal value: a subject is structured study, and personal things are activities
 * without a subject. It describes where the subject comes from; it does NOT say whether it is graded (that will be its own
 * setting): UNIVERSITY does not imply grades. `null` means "not specified" and is never read as one of the three.
 */
export const EDUCATION_CONTEXTS = ['UNIVERSITY', 'SCHOOL', 'OTHER_ACADEMIC'] as const;
export type EducationContext = (typeof EDUCATION_CONTEXTS)[number];
export const EDUCATION_CONTEXT_LABELS: Record<EducationContext, string> = {
  UNIVERSITY: 'Universidad',
  SCHOOL: 'Colegio',
  OTHER_ACADEMIC: 'Otro estudio',
};
export const educationContextSchema = z.enum(EDUCATION_CONTEXTS, {
  error: 'Elige un tipo de estudio válido.',
});

const subjectFields = {
  name: subjectNameSchema,
  color: subjectColorSchema,
  professor: optionalText(SUBJECT_PROFESSOR_MAX, 'El nombre del profesor'),
  description: optionalText(SUBJECT_DESCRIPTION_MAX, 'La descripción'),
};

/** The owner is never part of the input: it always comes from the authenticated session. */
export const createSubjectSchema = z.strictObject({
  periodId: z.uuid('Periodo inválido.'),
  name: subjectFields.name,
  color: subjectFields.color.default(DEFAULT_SUBJECT_COLOR),
  professor: subjectFields.professor,
  description: subjectFields.description,
  /** Omitted: the server uses the default of the user's primary use. `null` says "not specified" on purpose. */
  educationContext: educationContextSchema.nullable().optional(),
});

/** `periodId` is deliberately absent: moving subjects between periods is out of scope (strict rejects it). */
export const updateSubjectSchema = z.strictObject({
  name: subjectFields.name.optional(),
  color: subjectFields.color.optional(),
  professor: subjectFields.professor,
  description: subjectFields.description,
  /** A value sets it, `null` clears it (back to "not specified"), omitted leaves it. */
  educationContext: educationContextSchema.nullable().optional(),
});

export const SUBJECT_BATCH_MAX = 30;

/**
 * Several subjects at once (quick setup): names only. The period is always the user's CURRENT one, colors are assigned by the
 * server and the education context is one for the whole batch (omitted: the default of the primary use).
 */
export const createSubjectBatchSchema = z.strictObject({
  names: z
    .array(subjectNameSchema, { error: 'Indica las asignaturas.' })
    .min(1, 'Agrega al menos una asignatura.')
    .max(SUBJECT_BATCH_MAX, `Máximo ${SUBJECT_BATCH_MAX} asignaturas a la vez.`),
  educationContext: educationContextSchema.nullable().optional(),
});

/**
 * The distinct subjects a batch names, in the order they first appear: names that normalize to the same key
 * ("Farmacología", "farmacologia", " FARMACOLOGÍA ") are ONE subject, spelled as first written.
 */
export function dedupeSubjectNames(names: readonly string[]): { name: string; key: string }[] {
  const seen = new Set<string>();
  const out: { name: string; key: string }[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = normalizeNameKey(name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, key });
  }
  return out;
}

export const subjectSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  name: z.string(),
  professor: z.string().nullable(),
  color: z.string(),
  description: z.string().nullable(),
  /** Where the subject comes from; null = not specified (never inferred for older subjects). */
  educationContext: educationContextSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const subjectResponseSchema = z.object({ subject: subjectSchema });
export const subjectListResponseSchema = z.object({ subjects: z.array(subjectSchema) });
export const subjectBatchResponseSchema = z.object({
  /** Every subject the batch names, in the order of the (de-duplicated) input. */
  subjects: z.array(subjectSchema),
  /** The ones this request created. */
  createdSubjects: z.array(subjectSchema),
  /** The ones that already existed in the period and were reused as they are. */
  reusedSubjects: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type SubjectBatchResponse = z.infer<typeof subjectBatchResponseSchema>;
export type CreateSubjectBatchInput = z.infer<typeof createSubjectBatchSchema>;

export type Subject = z.infer<typeof subjectSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
