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

/** Optional text: '' and null both mean "no value"; undefined means "not provided" (PATCH). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} es demasiado largo (máximo ${max} caracteres).`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const requiredName = (max: number) =>
  z
    .string({ error: 'Ingresa un nombre.' })
    .trim()
    .min(1, 'Ingresa un nombre.')
    .max(max, `El nombre es demasiado largo (máximo ${max} caracteres).`);

// ───────────────────────── Academic period ─────────────────────────

export const PERIOD_NAME_MAX = 100;

const periodFields = {
  name: requiredName(PERIOD_NAME_MAX),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
};

/** `strict`: unknown keys (e.g. a client-sent `userId`) are rejected, never trusted or silently used. */
export const createPeriodSchema = z
  .strictObject({ ...periodFields, isCurrent: z.boolean().optional() })
  .refine((v) => isEndAfterStart(v.startDate, v.endDate), {
    path: ['endDate'],
    message: END_AFTER_START_MESSAGE,
  });

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
  })
  .refine((v) => !v.startDate || !v.endDate || isEndAfterStart(v.startDate, v.endDate), {
    path: ['endDate'],
    message: END_AFTER_START_MESSAGE,
  });

export const END_AFTER_START_ERROR = END_AFTER_START_MESSAGE;

export const periodSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const periodResponseSchema = z.object({ period: periodSchema });
export const periodListResponseSchema = z.object({ periods: z.array(periodSchema) });

export type AcademicPeriod = z.infer<typeof periodSchema>;
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>;

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

export const subjectColorSchema = z
  .string({ error: 'Elige un color de la paleta.' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(SUBJECT_COLOR_VALUES, { error: 'Elige un color de la paleta.' }));

const subjectFields = {
  name: requiredName(SUBJECT_NAME_MAX),
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
});

/** `periodId` is deliberately absent: moving subjects between periods is out of scope (strict rejects it). */
export const updateSubjectSchema = z.strictObject({
  name: subjectFields.name.optional(),
  color: subjectFields.color.optional(),
  professor: subjectFields.professor,
  description: subjectFields.description,
});

export const subjectSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  name: z.string(),
  professor: z.string().nullable(),
  color: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const subjectResponseSchema = z.object({ subject: subjectSchema });
export const subjectListResponseSchema = z.object({ subjects: z.array(subjectSchema) });

export type Subject = z.infer<typeof subjectSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
