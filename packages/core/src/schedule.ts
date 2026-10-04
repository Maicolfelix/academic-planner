import { z } from 'zod';
import { dateOnlySchema, isRealDateOnly, type DateOnly } from './academic.js';
import { dueTimeSchema } from './activity.js';
import { addDays, daysBetween, maxDate, minDate } from './calendar.js';
import { localDayBounds, toLocalParts, zonedTimeToUtc } from './time.js';

// ───────────────────────── Types ─────────────────────────

export const SCHEDULE_BLOCK_TYPES = ['CLASS', 'STUDY', 'ACADEMIC_PERSONAL'] as const;
export type ScheduleBlockType = (typeof SCHEDULE_BLOCK_TYPES)[number];
export const SCHEDULE_BLOCK_TYPE_LABELS: Record<ScheduleBlockType, string> = {
  CLASS: 'Clase',
  STUDY: 'Estudio',
  ACADEMIC_PERSONAL: 'Otro académico',
};

export const SCHEDULE_TITLE_MAX = 100;
/** A weekly query never needs more than a month and a half; it keeps every request cheap. */
export const SCHEDULE_MAX_RANGE_DAYS = 42;
export const SCHEDULE_CONFLICT_MESSAGE = 'Ya tienes otra actividad programada en este horario.';
export const WEEKLY_EDIT_NOTICE = 'Este cambio se aplicará a todas las semanas.';

// ───────────────────────── Pure rules ─────────────────────────

type Instant = Date | string;

/** Two blocks clash when A.start < B.end AND A.end > B.start: touching edges (10:00 / 10:00) do not. */
export function blocksOverlap(
  a: { startAt: Instant; endAt: Instant },
  b: { startAt: Instant; endAt: Instant },
) {
  return (
    new Date(a.startAt).getTime() < new Date(b.endAt).getTime() &&
    new Date(a.endAt).getTime() > new Date(b.startAt).getTime()
  );
}

/**
 * What the expansion needs to know about a block. `startAt`/`endAt` are the instants of the first
 * (or only) occurrence; with `recurrenceUntil` the block repeats weekly on the same LOCAL weekday and
 * wall-clock time, up to and including that local day.
 */
export interface ScheduleBlockLike {
  startAt: Instant;
  endAt: Instant;
  recurrenceUntil?: DateOnly | null;
  /** The period's days: a series never produces occurrences outside it (e.g. if the period was edited). */
  bounds?: { from: DateOnly; to: DateOnly };
}

export interface BlockOccurrence {
  /** Local day of the occurrence (YYYY-MM-DD). */
  date: DateOnly;
  startAt: Date;
  endAt: Date;
}

/**
 * Occurrences of a block that fall inside the local-day range [from, to] (both inclusive) of the user.
 * Pure: it reads no clock and touches no database, so it is the single place recurrence is computed.
 *
 * Weekly series are advanced by 7 CALENDAR days on the local calendar and each occurrence is converted
 * back from its wall-clock time — never "+7 × 24 h" in UTC — so a class at 08:00 stays at 08:00 across a
 * daylight-saving change, where the UTC instant moves by an hour.
 */
export function expandBlock(
  block: ScheduleBlockLike,
  range: { from: DateOnly; to: DateOnly },
  timeZone: string,
): BlockOccurrence[] {
  const start = new Date(block.startAt);
  const end = new Date(block.endAt);

  if (!block.recurrenceUntil) {
    const rangeStart = localDayBounds(range.from, timeZone).start;
    const rangeEnd = localDayBounds(range.to, timeZone).end;
    return blocksOverlap({ startAt: start, endAt: end }, { startAt: rangeStart, endAt: rangeEnd })
      ? [{ date: toLocalParts(start, timeZone).date, startAt: start, endAt: end }]
      : [];
  }

  const first = toLocalParts(start, timeZone);
  const last = toLocalParts(end, timeZone);
  const endDayOffset = daysBetween(first.date, last.date);
  const [startHour, startMinute] = first.time.split(':').map(Number) as [number, number];
  const [endHour, endMinute] = last.time.split(':').map(Number) as [number, number];

  const lo = maxDate(maxDate(range.from, first.date), block.bounds?.from ?? range.from);
  const hi = minDate(minDate(range.to, block.recurrenceUntil), block.bounds?.to ?? range.to);
  if (lo > hi) return [];

  // The first date on or after `lo` that is a whole number of weeks after the first occurrence.
  const weeksToSkip = Math.ceil(daysBetween(first.date, lo) / 7);
  const occurrences: BlockOccurrence[] = [];
  for (let date = addDays(first.date, weeksToSkip * 7); date <= hi; date = addDays(date, 7)) {
    occurrences.push({
      date,
      startAt: zonedTimeToUtc({ date, hour: startHour, minute: startMinute }, timeZone),
      endAt: zonedTimeToUtc(
        { date: addDays(date, endDayOffset), hour: endHour, minute: endMinute },
        timeZone,
      ),
    });
  }
  return occurrences;
}

/** The user's input (a local day and two wall-clock times) -> the instants stored for the first occurrence. */
export function blockInstants(
  input: { date: DateOnly; startTime: string; endTime: string },
  timeZone: string,
): { startAt: Date; endAt: Date } {
  const at = (time: string) => {
    const [hour, minute] = time.split(':').map(Number) as [number, number];
    return zonedTimeToUtc({ date: input.date, hour, minute }, timeZone);
  };
  return { startAt: at(input.startTime), endAt: at(input.endTime) };
}

export interface BlockConflict {
  blockId: string;
  /** How many of the other block's occurrences clash with the candidate. */
  occurrences: number;
  /** The first clashing occurrence of the OTHER block. */
  first: BlockOccurrence;
}

/**
 * Which of `others` overlap `candidate` at any occurrence. Both sides are expanded over the candidate's
 * whole span (one day for a single block, the whole series for a weekly one), so a new weekly class
 * is checked against other weekly classes — not just against the date it was created on.
 * `candidate` itself is skipped when it also appears in `others` (editing a block must not clash with itself).
 */
export function findConflicts(
  candidate: ScheduleBlockLike & { id?: string },
  others: (ScheduleBlockLike & { id: string })[],
  timeZone: string,
): BlockConflict[] {
  const firstDay = toLocalParts(candidate.startAt, timeZone).date;
  const window = {
    from: firstDay,
    to: candidate.recurrenceUntil
      ? minDate(candidate.recurrenceUntil, candidate.bounds?.to ?? candidate.recurrenceUntil)
      : toLocalParts(candidate.endAt, timeZone).date,
  };
  const mine = expandBlock(candidate, window, timeZone);
  if (mine.length === 0) return [];

  const conflicts: BlockConflict[] = [];
  for (const other of others) {
    if (other.id === candidate.id) continue;
    const clashing = expandBlock(other, window, timeZone).filter((o) =>
      mine.some((m) => blocksOverlap(m, o)),
    );
    if (clashing.length > 0) {
      conflicts.push({ blockId: other.id, occurrences: clashing.length, first: clashing[0]! });
    }
  }
  return conflicts;
}

/** For a list of occurrences: which ones overlap another one of the same list (used to flag the agenda). */
export function markOverlaps(items: { startAt: Instant; endAt: Instant }[]): boolean[] {
  return items.map((a, i) => items.some((b, j) => i !== j && blocksOverlap(a, b)));
}

// ───────────────────────── Input schemas ─────────────────────────

/** `HH:mm`, 24h. Comparing two of them as strings is comparing them in time. */
const timeOfDay = dueTimeSchema;

const END_AFTER_START = 'La hora de fin debe ser posterior a la de inicio.';

const title = z
  .string({ error: 'Ingresa un título.' })
  .trim()
  .min(1, 'Ingresa un título.')
  .max(
    SCHEDULE_TITLE_MAX,
    `El título es demasiado largo (máximo ${SCHEDULE_TITLE_MAX} caracteres).`,
  );

/**
 * The only repetition supported today: every week, on the weekday of the first occurrence, until a day.
 * Shaped as an object with a `frequency` so other frequencies can be added without touching storage.
 */
export const weeklyRecurrenceSchema = z.strictObject({
  frequency: z.literal('WEEKLY'),
  until: dateOnlySchema,
});

const typeField = z.enum(SCHEDULE_BLOCK_TYPES, { error: 'Tipo inválido.' });

/**
 * Same input for a one-off block and for a weekly series (`recurrence`), and the one a future
 * schedule import will reuse: it only needs a date, two times and, optionally, `recurrence`.
 * Owner is never part of it (session only); `strict` rejects any unknown key such as `userId`.
 */
export const createScheduleBlockSchema = z
  .strictObject({
    type: typeField,
    subjectId: z.uuid('Asignatura inválida.').nullish(),
    /** Defaults to the user's current period. */
    periodId: z.uuid('Periodo inválido.').optional(),
    title,
    /** Local day of the first (or only) occurrence. */
    date: dateOnlySchema,
    startTime: timeOfDay,
    endTime: timeOfDay,
    recurrence: weeklyRecurrenceSchema.nullish(),
  })
  .refine((v) => v.endTime > v.startTime, { path: ['endTime'], message: END_AFTER_START })
  .refine((v) => !v.recurrence || v.recurrence.until >= v.date, {
    path: ['recurrence'],
    message: 'La fecha final de la repetición no puede ser anterior a la fecha de inicio.',
  });

/**
 * `periodId` cannot change (blocks do not move between periods). `recurrence: null` turns a series into
 * a single block; an object turns it into a weekly series. Editing a series edits ALL of its weeks.
 */
export const updateScheduleBlockSchema = z
  .strictObject({
    type: typeField.optional(),
    subjectId: z.uuid('Asignatura inválida.').nullish(),
    title: title.optional(),
    date: dateOnlySchema.optional(),
    startTime: timeOfDay.optional(),
    endTime: timeOfDay.optional(),
    recurrence: weeklyRecurrenceSchema.nullish(),
  })
  .refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    path: ['endTime'],
    message: END_AFTER_START,
  });

const queryDay = z.string().refine(isRealDateOnly, 'Ingresa una fecha válida.');

/** Local days of the user, inclusive. Both or neither: with neither, the current week is used. */
export const scheduleQuerySchema = z
  .object({ from: queryDay.optional(), to: queryDay.optional() })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    path: ['to'],
    message: 'Indica "desde" y "hasta" juntos.',
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, {
    path: ['to'],
    message: 'La fecha "hasta" no puede ser anterior a "desde".',
  })
  .refine((q) => !q.from || !q.to || daysBetween(q.from, q.to) < SCHEDULE_MAX_RANGE_DAYS, {
    path: ['to'],
    message: `El rango no puede superar ${SCHEDULE_MAX_RANGE_DAYS} días.`,
  });

// ───────────────────────── Response schemas ─────────────────────────

const subjectRef = z.object({ id: z.uuid(), name: z.string(), color: z.string() });
const weekday = z.number().int().min(1).max(7);

/** The stored block (a series is ONE block), with its first occurrence expressed in the user's timezone. */
export const scheduleBlockSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  subjectId: z.uuid().nullable(),
  subject: subjectRef.nullable(),
  title: z.string(),
  type: z.enum(SCHEDULE_BLOCK_TYPES),
  /** Local day, start and end time ("HH:mm") of the first occurrence. */
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  recurrence: z.object({ frequency: z.literal('WEEKLY'), weekday, until: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** One appearance of a block on a given day: derived at read time, never stored. */
export const scheduleOccurrenceSchema = z.object({
  blockId: z.uuid(),
  periodId: z.uuid(),
  occurrenceDate: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  title: z.string(),
  type: z.enum(SCHEDULE_BLOCK_TYPES),
  subject: subjectRef.nullable(),
  isRecurring: z.boolean(),
  /** Overlaps another occurrence of the same response. A warning, never an error. */
  hasConflict: z.boolean(),
});

export const scheduleWarningSchema = z.object({
  code: z.literal('SCHEDULE_CONFLICT'),
  message: z.string(),
  with: z.object({
    blockId: z.uuid(),
    title: z.string(),
    type: z.enum(SCHEDULE_BLOCK_TYPES),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    occurrences: z.number().int().positive(),
  }),
});

export const scheduleBlockResponseSchema = z.object({ block: scheduleBlockSchema });
/** `block` is null for a dry run (`?dryRun=true`): nothing was saved, only checked. */
export const scheduleWriteResponseSchema = z.object({
  block: scheduleBlockSchema.nullable(),
  warnings: z.array(scheduleWarningSchema),
});
export const scheduleListResponseSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  occurrences: z.array(scheduleOccurrenceSchema),
});

export type ScheduleBlock = z.infer<typeof scheduleBlockSchema>;
export type ScheduleOccurrence = z.infer<typeof scheduleOccurrenceSchema>;
export type ScheduleWarning = z.infer<typeof scheduleWarningSchema>;
export type CreateScheduleBlockInput = z.infer<typeof createScheduleBlockSchema>;
export type UpdateScheduleBlockInput = z.infer<typeof updateScheduleBlockSchema>;
/** What a client may send on update: every field optional (the parsed type has them all resolved). */
export type UpdateScheduleBlockRequest = z.input<typeof updateScheduleBlockSchema>;
export type CreateScheduleBlockRequest = z.input<typeof createScheduleBlockSchema>;
