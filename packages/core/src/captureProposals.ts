import { z } from 'zod';
import { normalizeNameKey, periodSchema, type DateOnly } from './academic.js';
import { titlesAreRelated, ACADEMIC_CUES } from './academicInbox.js';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, type ActivityType } from './activity.js';
import { addDays, weekdayOf, type Weekday } from './calendar.js';
import { gradeCaptureSchema } from './captureGrades.js';
import { describeTokens, maskMetaText } from './captureContext.js';
import { segmentDiscourse, type DiscourseSpan } from './captureDiscourse.js';
import {
  FIELD_CERTAINTIES,
  QUICK_CAPTURE_MESSAGES,
  STOPWORDS,
  buildSubjectEntries,
  capitalize,
  cloneTokens,
  findDateExpressions,
  interpretWords,
  matchSubject,
  resolveDate,
  tokenize,
  type FieldCertainty,
  type QuickCaptureContext,
  type SubjectEntry,
  type Token,
} from './captureShared.js';
import {
  planTemporal,
  type PlannedDay,
  type PlannedTime,
  type TemporalPlan,
  type TimeIssue,
} from './captureTemporal.js';
import { dueFromLocal, toLocalParts } from './time.js';

/**
 * THE CAPTURE ENGINE: one text -> 1..N proposals, for Quick Capture and the Academic Inbox alike.
 *
 * The student writes once; the engine reads everything it can and asks only about what is really missing. A text can
 * hold several activities ("parcial martes y exposición jueves") and one activity can hold several days ("ensayo
 * lunes, martes, jueves y viernes, los dos primeros a las 7:30 y los otros dos a las 5:40 pm"): both become one
 * proposal per activity per day, each already resolved. Nothing is stored here, nothing is created and nothing is
 * invented: a field the text does not say is MISSING, an ambiguous one carries its alternatives, and a proposal that is
 * complete is READY and needs no touch. It is the same deterministic machinery as before (tokens, `planTemporal`,
 * `interpretWords`, subject matching): no AI, no remote service, `now` injected. See docs/capture-proposals.md.
 *
 * Which proposals need the student:
 *  - READY: every field it needs is determined; it starts selected.
 *  - NEEDS_REVIEW: something real is missing or ambiguous (the subject, an hour with no am/pm, a day with no hour
 *    assigned, no date). Only that proposal, and only that field, asks.
 *  - INVALID: what was written cannot be used as it is (an impossible date, no title at all).
 * Blocking issues are separate from warnings: a warning ("the date already passed") informs and never blocks.
 */

export const CAPTURE_MAX_PROPOSALS = 50;
/** A weekly class or study session per weekday: more than this in one capture is not a normal text. */
export const CAPTURE_MAX_BLOCKS = 21;
/**
 * The shape and meaning of a result. A review the student left half done is kept as a draft; a draft written by another
 * version of the engine is not trusted (it is dropped, never repaired). Bump it when the proposals change.
 */
export const CAPTURE_ENGINE_VERSION = 3;
export const CAPTURE_MODES = ['QUICK', 'INBOX'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];
/** Characters a text of each mode may have (a quick phrase vs a pasted message). */
export const CAPTURE_MAX_LENGTH: Record<CaptureMode, number> = { QUICK: 5000, INBOX: 5000 };
/** Hard cap of the request body: far above the product limits, only a guard against abuse. */
export const CAPTURE_REQUEST_MAX = 20_000;

export const CAPTURE_MESSAGES = {
  EMPTY: 'Escribe o pega algo para continuar.',
  TOO_LONG_QUICK: 'Este texto parece demasiado largo para Captura rápida.',
  TOO_LONG_INBOX: 'El texto es demasiado largo. Pega únicamente el mensaje académico relevante.',
  TOO_MANY_PROPOSALS: `Encontré más de ${CAPTURE_MAX_PROPOSALS} actividades. Divide el mensaje en dos partes para revisarlas mejor.`,
  NO_ACTIVITIES: 'No encontramos actividades claras en este mensaje.',
} as const;

// ───────────────────────── Shape ─────────────────────────

const certainty = z.enum(FIELD_CERTAINTIES);
/**
 * Where a value came from: the words next to it (PARSED), the rest of the sentence or group (INHERITED), a LATER clause
 * that referred back to it ("el parcial es a las 7": REFERENCE), a positional distribution ("los dos primeros":
 * POSITIONAL), a default, or the student (USER, set by the interface). The interface only highlights what is in doubt;
 * this says how each value got there.
 */
const origin = z.enum(['PARSED', 'INHERITED', 'REFERENCE', 'POSITIONAL', 'DEFAULT', 'USER']);
const subjectRef = z.object({ id: z.uuid(), name: z.string() });

export const CAPTURE_ISSUE_CODES = [
  'TITLE_MISSING',
  'SUBJECT_AMBIGUOUS',
  'SUBJECT_UNKNOWN',
  'DATE_MISSING',
  'DATE_INVALID',
  'TIME_AMBIGUOUS',
  'TIME_INVALID',
  'TIME_UNASSIGNED',
  'TIME_COUNT_MISMATCH',
  'CONFLICTING_DATE',
  'CONFLICTING_TIME',
  'REFERENCE_AMBIGUOUS',
  'QUANTITY_DATE_MISMATCH',
  'UNRESOLVED_TIME_REFERENCE',
  'UNRESOLVED_DATE_REFERENCE',
  'UNRESOLVED_DESCRIPTION_REFERENCE',
  'COUNT_MISMATCH',
  'START_TIME_MISSING',
  'END_TIME_MISSING',
] as const;
export type CaptureIssueCode = (typeof CAPTURE_ISSUE_CODES)[number];

export const CAPTURE_WARNING_CODES = [
  'TYPE_DEFAULTED',
  'TITLE_FROM_SUBJECT',
  'TITLE_TRUNCATED',
  'PAST_DATE',
  'PAST_TIME_TODAY',
  'MOVED_TO_NEXT_WEEK',
  'WEEKDAY_MISMATCH',
  'DATE_OUTSIDE_PERIOD',
  'SUBJECT_INHERITED',
  'POSSIBLE_DUPLICATE',
  'QUANTITY_DATE_MISMATCH',
] as const;
export type CaptureWarningCode = (typeof CAPTURE_WARNING_CODES)[number];

const issue = z.object({
  code: z.enum(CAPTURE_ISSUE_CODES),
  field: z.enum(['title', 'subject', 'date', 'time', 'endTime', 'description', 'count']),
  message: z.string(),
});
const warning = z.object({ code: z.enum(CAPTURE_WARNING_CODES), message: z.string() });

/**
 * The subject, as the engine understands it. "The words do not mention a subject" is NOT "a subject I could not
 * resolve": an activity may legitimately have none, so saying nothing about it is a decision already made, never a
 * question.
 *  - EXISTING: one of the student's subjects (EXACT or LIKELY);
 *  - NONE: a general activity. NOT_MENTIONED (the words say nothing about a subject, whether the student has subjects
 *    or not), NO_SUBJECTS (the student has none at all) or USER (set by the interface when the student omits it). It
 *    never blocks;
 *  - UNRESOLVED: the words TRIED to name a subject and it cannot be resolved: AMBIGUOUS (several fit: `candidates`) or
 *    UNKNOWN_NAME (it names a subject that does not exist: `suggestedName`). The student picks, creates or omits it;
 *    the engine never does. It blocks.
 */
export const captureSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXISTING'), id: z.uuid(), name: z.string(), certainty, origin }),
  z.object({
    kind: z.literal('NONE'),
    reason: z.enum(['NOT_MENTIONED', 'NO_SUBJECTS', 'USER']),
    certainty,
    origin,
  }),
  z.object({
    kind: z.literal('UNRESOLVED'),
    reason: z.enum(['AMBIGUOUS', 'UNKNOWN_NAME']),
    candidates: z.array(subjectRef),
    suggestedName: z.string().nullable(),
    certainty,
    origin,
  }),
]);
export type CaptureSubject = z.infer<typeof captureSubjectSchema>;

const stringField = z.object({ value: z.string(), certainty, origin });

export const captureProposalSchema = z.object({
  /** Identifies the proposal in this response (the UI keeps its edits under it). Never stored. */
  clientId: z.string(),
  /** Proposals that came from the same words (one activity on several days) share it. */
  groupId: z.string(),
  /** READY and not a likely duplicate: ticked by default. */
  selected: z.boolean(),
  status: z.enum(['READY', 'NEEDS_REVIEW', 'INVALID']),
  /** The words this proposal came from (never stored). */
  rawSegment: z.string(),
  title: stringField.extend({
    /**
     * Only when the subject is an OFFERED name that does not exist yet ("parcial de ciberseguridad"): the title without
     * that name ("Parcial"), for when the student accepts the subject. `value` keeps every word written, so answering
     * "sin asignatura" loses nothing.
     */
    withoutSubject: z.string().nullable().default(null),
  }),
  type: z.object({ value: z.enum(ACTIVITY_TYPES), certainty, origin }),
  subject: captureSubjectSchema,
  date: z.object({
    value: z.string().nullable(),
    certainty,
    origin,
    /** The dates the text gave for the same activity when they disagree (the student chooses). */
    alternatives: z.array(z.string()),
  }),
  time: z.object({
    /** HH:mm, 24 hours. null: no time, or an ambiguous one (see `alternatives`). */
    value: z.string().nullable(),
    hasTime: z.boolean(),
    certainty,
    origin,
    /** "a las 6" -> 06:00 and 18:00, the usual one first. */
    alternatives: z.array(z.string()),
    /** The days that share one time expression share this key: one correction fixes them all. */
    groupKey: z.string().nullable(),
  }),
  /**
   * What the student said ABOUT the activity (optional, never blocks): only words they wrote, kept in order. `offered` is
   * a piece of context that could not be assigned with certainty: shown to be taken or ignored, never applied.
   */
  description: z.object({
    value: z.string().nullable(),
    certainty,
    origin,
    offered: z.string().nullable(),
  }),
  /** Anything that keeps it from being created as it is. Empty when READY. */
  blockingIssues: z.array(issue),
  /** Informative only: never blocks. */
  warnings: z.array(warning),
  /** "Ciberseguridad martes y jueves a las 6" may be a weekly class: only worth asking, never assumed. */
  possibleRecurrence: z.boolean(),
  /** An existing activity of the student that looks like this one (set by the service). */
  duplicateOf: z.object({ id: z.uuid(), title: z.string() }).nullable(),
});
export type CaptureProposal = z.infer<typeof captureProposalSchema>;

/**
 * What a repeating thing the student said becomes. A weekly CLASS (or study session) belongs to the timetable: it is one
 * ScheduleBlock per weekday, never a pile of future activities. "Todos los martes y jueves de 6 a 8" is two slots.
 *  - WEEKLY_SCHEDULE: a class or study session that repeats every week; it can be created as ScheduleBlocks;
 *  - RECURRING_ACTIVITY_UNSUPPORTED: something that is due ("un quiz todos los viernes") and repeats: the intention is kept
 *    and shown, but a repeating activity is NOT something the app can create yet (and it is never turned into a class).
 */
const slotTime = z.object({
  value: z.string().nullable(),
  certainty,
  alternatives: z.array(z.string()),
});
export const RECURRENCE_KINDS = ['WEEKLY_SCHEDULE', 'RECURRING_ACTIVITY_UNSUPPORTED'] as const;
export const recurrenceSuggestionSchema = z.object({
  clientId: z.string(),
  groupId: z.string(),
  rawSegment: z.string(),
  kind: z.enum(RECURRENCE_KINDS),
  /** The block it would create. A CLASS needs a subject; a STUDY session may have none. */
  blockType: z.enum(['CLASS', 'STUDY']),
  title: stringField,
  subject: captureSubjectSchema,
  slots: z.array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      /** Start. */
      time: slotTime,
      /** End: never invented. Missing until the student says it (or it was written as a range: "de 6 a 8"). */
      endTime: slotTime,
    }),
  ),
  /** The last day of the repetition: the period's end, which the server decides (it is never the client's). */
  until: z.object({ value: z.string().nullable(), certainty, origin }),
  /** The words that say it repeats. */
  evidence: z.array(z.string()),
  /** What a weekly block still needs. */
  missing: z.array(z.enum(['subject', 'startTime', 'endTime', 'until'])),
  /** READY: can be created as it is. NEEDS_REVIEW: a question is open. UNSUPPORTED: understood, not creatable yet. */
  status: z.enum(['READY', 'NEEDS_REVIEW', 'UNSUPPORTED']),
  selected: z.boolean(),
  blockingIssues: z.array(issue),
});
export type RecurrenceSuggestion = z.infer<typeof recurrenceSuggestionSchema>;

/** One decision for several proposals that share the same missing or ambiguous thing. */
export const captureCorrectionSchema = z.object({
  field: z.enum(['subject', 'time']),
  /** Same key = same question: "AMBIGUOUS:<ids>", "UNKNOWN:<name key>", or a time group key. */
  key: z.string(),
  clientIds: z.array(z.string()).min(2),
  candidates: z.array(subjectRef),
  suggestedName: z.string().nullable(),
  alternatives: z.array(z.string()),
});
export type CaptureCorrection = z.infer<typeof captureCorrectionSchema>;

export const captureResultSchema = z.object({
  status: z.enum(['OK', 'EMPTY', 'TOO_LONG', 'TOO_MANY_PROPOSALS']),
  proposals: z.array(captureProposalSchema).max(CAPTURE_MAX_PROPOSALS),
  suggestions: z.array(recurrenceSuggestionSchema),
  corrections: z.array(captureCorrectionSchema),
  warnings: z.array(
    z.object({
      code: z.enum(['EMPTY', 'TOO_LONG', 'TOO_MANY_PROPOSALS', 'NO_ACTIVITIES', 'COUNT_MISMATCH']),
      message: z.string(),
    }),
  ),
  stats: z.object({
    characters: z.number().int().nonnegative(),
    /** Activities found before the limit and the duplicate collapse. */
    found: z.number().int().nonnegative(),
    collapsed: z.number().int().nonnegative(),
    /** How many activities the student said there were ("tengo 3 actividades…"), or null when they did not say. */
    expected: z.number().int().positive().nullable().default(null),
  }),
});
export type CaptureResult = z.infer<typeof captureResultSchema>;

/** POST /api/capture/parse. Strict: the text and which flavour of text it is, nothing else. */
export const captureRequestSchema = z.strictObject({
  text: z
    .string({ error: CAPTURE_MESSAGES.EMPTY })
    .max(CAPTURE_REQUEST_MAX, CAPTURE_MESSAGES.TOO_LONG_INBOX),
  mode: z.enum(CAPTURE_MODES).default('QUICK'),
});
export type CaptureRequest = z.input<typeof captureRequestSchema>;

export const captureResponseSchema = z.object({
  capture: captureResultSchema,
  period: periodSchema.nullable(),
  /** What the same words say about grades (B3): scores, cut grades and new evaluations. Empty when they say nothing. */
  grades: gradeCaptureSchema.default({ suggestions: [] }),
});
export type CaptureResponse = z.infer<typeof captureResponseSchema>;

// ───────────────────────── Engine ─────────────────────────

const ISSUE_MESSAGES: Record<CaptureIssueCode, string> = {
  TITLE_MISSING: 'Falta el título.',
  SUBJECT_AMBIGUOUS: QUICK_CAPTURE_MESSAGES.AMBIGUOUS_SUBJECT,
  SUBJECT_UNKNOWN: 'La asignatura no existe todavía.',
  DATE_MISSING: QUICK_CAPTURE_MESSAGES.MISSING_DATE,
  DATE_INVALID: 'La fecha no es válida.',
  TIME_AMBIGUOUS: 'La hora no dice a. m. o p. m.',
  TIME_INVALID: 'La hora no es válida.',
  TIME_UNASSIGNED: 'No quedó claro a qué días corresponde cada hora.',
  TIME_COUNT_MISMATCH: 'La cantidad de horas no coincide con la de días.',
  CONFLICTING_DATE: 'El texto da fechas distintas para la misma actividad: elige una.',
  CONFLICTING_TIME: 'El texto da horas distintas para la misma actividad: elige una.',
  REFERENCE_AMBIGUOUS: 'No quedó claro a qué actividad se refiere una aclaración.',
  QUANTITY_DATE_MISMATCH: 'La cantidad de actividades no coincide con la de fechas.',
  UNRESOLVED_TIME_REFERENCE: 'Mencionaste una hora, pero no pude asignarla a esta actividad.',
  UNRESOLVED_DATE_REFERENCE: 'Mencionaste una fecha, pero no pude asignarla a esta actividad.',
  UNRESOLVED_DESCRIPTION_REFERENCE:
    'Mencionaste un detalle, pero no pude saber a qué actividad corresponde.',
  COUNT_MISMATCH: 'La cantidad de actividades no coincide con la que dijiste.',
  START_TIME_MISSING: '¿A qué hora empieza?',
  END_TIME_MISSING: '¿Hasta qué hora?',
};
const ISSUE_FIELD: Record<CaptureIssueCode, CaptureProposal['blockingIssues'][number]['field']> = {
  TITLE_MISSING: 'title',
  SUBJECT_AMBIGUOUS: 'subject',
  SUBJECT_UNKNOWN: 'subject',
  DATE_MISSING: 'date',
  DATE_INVALID: 'date',
  TIME_AMBIGUOUS: 'time',
  TIME_INVALID: 'time',
  TIME_UNASSIGNED: 'time',
  TIME_COUNT_MISMATCH: 'time',
  CONFLICTING_DATE: 'date',
  CONFLICTING_TIME: 'time',
  REFERENCE_AMBIGUOUS: 'time',
  QUANTITY_DATE_MISMATCH: 'date',
  UNRESOLVED_TIME_REFERENCE: 'time',
  UNRESOLVED_DATE_REFERENCE: 'date',
  UNRESOLVED_DESCRIPTION_REFERENCE: 'description',
  COUNT_MISMATCH: 'count',
  START_TIME_MISSING: 'time',
  END_TIME_MISSING: 'endTime',
};
const makeIssue = (
  code: CaptureIssueCode,
  message = ISSUE_MESSAGES[code],
  field: CaptureProposal['blockingIssues'][number]['field'] = ISSUE_FIELD[code],
) => ({ code, field, message });
const WARNING_MESSAGES: Record<CaptureWarningCode, string> = {
  TYPE_DEFAULTED: 'No reconocí un tipo: la propuse como tarea.',
  TITLE_FROM_SUBJECT: 'El título es el nombre de la asignatura: cámbialo si quieres.',
  TITLE_TRUNCATED: QUICK_CAPTURE_MESSAGES.TITLE_TRUNCATED,
  PAST_DATE: QUICK_CAPTURE_MESSAGES.PAST_DATE,
  PAST_TIME_TODAY: QUICK_CAPTURE_MESSAGES.PAST_TIME_TODAY,
  MOVED_TO_NEXT_WEEK: QUICK_CAPTURE_MESSAGES.MOVED_TO_NEXT_WEEK,
  WEEKDAY_MISMATCH: QUICK_CAPTURE_MESSAGES.WEEKDAY_MISMATCH,
  DATE_OUTSIDE_PERIOD: QUICK_CAPTURE_MESSAGES.DATE_OUTSIDE_PERIOD,
  SUBJECT_INHERITED: 'La asignatura se tomó del resto de la oración: verifícala.',
  POSSIBLE_DUPLICATE: 'Ya existe una actividad similar.',
  QUANTITY_DATE_MISMATCH: 'La cantidad de actividades no coincide con la de fechas.',
};
const makeWarning = (code: CaptureWarningCode) => ({ code, message: WARNING_MESSAGES[code] });

const emptyResult = (
  status: 'EMPTY' | 'TOO_LONG',
  characters: number,
  message: string,
): CaptureResult => ({
  status,
  proposals: [],
  suggestions: [],
  corrections: [],
  warnings: [{ code: status, message }],
  stats: { characters, found: 0, collapsed: 0, expected: null },
});

/** Words that follow "parcial de …" without being a subject ("parcial de unidad"): never offered as a new subject's name. */
const NOT_A_SUBJECT_NAME = new Set([
  'unidad',
  'unidades',
  'capitulo',
  'capitulos',
  'tema',
  'temas',
  'modulo',
  'modulos',
  'corte',
  'semana',
  'final',
  'primer',
  'primero',
  'segundo',
  'tercer',
  'tercero',
  'proyecto',
  'informe',
  'taller',
  'guia',
  'lectura',
  'clase',
  'laboratorio',
]);

/**
 * "Parcial de ciberseguridad" when Ciberseguridad does not exist: the words after "de" (up to four, no digits, not a
 * generic noun) are offered as the name of a subject to create. Only after a recognised type word AND a "de": without
 * that connector "parcial unidad 3" or "parcial final" would look like subjects. Offered, never applied.
 */
function suggestSubjectName(tokens: readonly Token[], typeRecognised: boolean): string | null {
  if (!typeRecognised) return null;
  const rest = tokens.filter((t) => !t.used);
  if (rest.length < 2 || (rest[0]!.norm !== 'de' && rest[0]!.norm !== 'del')) return null;
  const name = rest.slice(1);
  while (name.length > 0 && STOPWORDS.has(name[0]!.norm)) name.shift();
  while (name.length > 0 && STOPWORDS.has(name.at(-1)!.norm)) name.pop();
  if (name.length === 0 || name.length > 4) return null;
  if (name.some((t) => /\d/.test(t.norm)) || NOT_A_SUBJECT_NAME.has(name[0]!.norm)) return null;
  return capitalize(name.map((t) => t.raw).join(' '));
}

/**
 * Which mentions share ONE day said once, as the index of the mention that is the root of their group (null = in no group).
 * Pure and structural, in the order written, and never by text or by sentence alone:
 *  - a mention that carries a day of its own opens a possible root (and a later one with another day opens another);
 *  - a mention that INHERITS a day belongs to the latest root of its sentence that carries that very same day; if nobody
 *    carries it (the day was said before the first activity) the first inheriting mention of that sentence and day is the root.
 * So two chains of inheritance in the same sentence get two roots, and two sentences worded the same never meet.
 */
export function sharedDayRoots(
  items: readonly { sentence: number; inherited: boolean; days: string }[],
): (number | null)[] {
  const result: (number | null)[] = items.map(() => null);
  const carriers: { index: number; sentence: number; days: string }[] = [];
  const orphans = new Map<string, number>();
  items.forEach((item, i) => {
    if (!item.inherited) {
      carriers.push({ index: i, sentence: item.sentence, days: item.days });
      return;
    }
    const carrier = [...carriers]
      .reverse()
      .find((c) => c.sentence === item.sentence && c.days === item.days);
    const key = `${item.sentence}\u0000${item.days}`;
    const root = carrier ? carrier.index : (orphans.get(key) ?? i);
    if (!carrier && !orphans.has(key)) orphans.set(key, i);
    result[i] = root;
    result[root] = root;
  });
  return result;
}

interface ResolvedDay {
  date: DateOnly | null;
  certainty: FieldCertainty;
  invalidText?: string;
  warnings: CaptureWarningCode[];
}

/**
 * The calendar date of each planned day. Each is the next occurrence of its weekday (the existing rule); a list of
 * weekdays is read as ONE coherent run: if a day lands before the previous one it is the following week's ("lunes,
 * martes…" written on a Monday afternoon with a morning time is next Monday AND next Tuesday, never Tuesday before
 * Monday).
 */
function resolveDays(
  days: readonly PlannedDay[],
  today: DateOnly,
  ctx: Pick<QuickCaptureContext, 'now' | 'timeZone' | 'period'>,
  timeOf: (day: PlannedDay) => PlannedTime | null,
): ResolvedDay[] {
  let previous: DateOnly | null = null;
  return days.map((day) => {
    const time = timeOf(day);
    // Only a time that is certain can move a day to next week ("martes a las 7" said on Tuesday at 3 pm).
    const known = time && time.value !== null && time.certainty !== 'AMBIGUOUS' ? time.value : null;
    const r = resolveDate(day.expr, today, known, ctx, day.text);
    const warnings: CaptureWarningCode[] = [];
    if (r.date === null) {
      previous = null;
      return { date: null, certainty: 'MISSING', invalidText: r.invalidText ?? day.text, warnings };
    }
    let date = r.date;
    let moved = r.movedToNextWeek === true;
    if (day.expr.kind === 'weekday') {
      while (previous !== null && date < previous) {
        date = addDays(date, 7);
        moved = true;
      }
      previous = date;
    } else {
      previous = null;
    }
    if (moved) warnings.push('MOVED_TO_NEXT_WEEK');
    if (day.weekdayHint !== undefined && weekdayOf(date) !== day.weekdayHint) {
      warnings.push('WEEKDAY_MISMATCH');
    }
    if (ctx.period && (date < ctx.period.startDate || date > ctx.period.endDate)) {
      warnings.push('DATE_OUTSIDE_PERIOD');
    }
    if (date < today) {
      warnings.push('PAST_DATE');
    } else if (
      date === today &&
      known !== null &&
      dueFromLocal({ date, time: known }, ctx.timeZone).dueAt < ctx.now
    ) {
      warnings.push('PAST_TIME_TODAY');
    }
    return { date, certainty: r.certainty, warnings };
  });
}

type Draft = Omit<CaptureProposal, 'clientId' | 'selected'>;

/** What is read ONCE per stretch of text and shared by every proposal that comes out of it. */
interface Reading {
  groupId: string;
  rawSegment: string;
  title: CaptureProposal['title'];
  type: CaptureProposal['type'];
  subject: CaptureSubject;
  words: ReturnType<typeof interpretWords>;
  tokens: Token[];
  warnings: CaptureWarningCode[];
  blocking: CaptureProposal['blockingIssues'];
  implicit: boolean;
  description: string | null;
}

function readWords(
  span: { rawSegment: string; implicitType: ActivityType | null; cutTitle: boolean },
  tokens: Token[],
  shared: Token[] | undefined,
  groupId: string,
  ctx: QuickCaptureContext,
  mode: CaptureMode,
): Reading {
  const words = interpretWords(tokens, ctx, {
    flagMultipleTypes: false,
    richTitle: mode === 'INBOX',
    cutTitleAtStops: span.cutTitle,
    implicitType: span.implicitType,
    shared,
  });
  const warnings: CaptureWarningCode[] = [];
  const blocking: CaptureProposal['blockingIssues'] = [];

  // Subject: matched, ambiguous, named but unknown, not said, or nothing to choose from.
  const inherited = words.meta.subjectFromShared;
  const subjectOrigin = inherited ? 'INHERITED' : 'PARSED';
  let subject: CaptureSubject;
  let suggestedName: string | null = null;
  if (words.subjectId !== null) {
    const found = ctx.subjects.find((s) => s.id === words.subjectId)!;
    subject = {
      kind: 'EXISTING',
      id: found.id,
      name: found.name,
      certainty: words.subjectCertainty,
      origin: subjectOrigin,
    };
    if (inherited) warnings.push('SUBJECT_INHERITED');
  } else if (words.ambiguities.length > 0) {
    subject = {
      kind: 'UNRESOLVED',
      reason: 'AMBIGUOUS',
      candidates: words.ambiguities[0]!.candidates,
      suggestedName: null,
      certainty: 'AMBIGUOUS',
      origin: subjectOrigin,
    };
    blocking.push(makeIssue('SUBJECT_AMBIGUOUS'));
  } else if (ctx.subjects.length === 0) {
    // Nothing to choose from: a general activity.
    subject = { kind: 'NONE', reason: 'NO_SUBJECTS', certainty: 'MISSING', origin: 'DEFAULT' };
  } else {
    // Only a construction that names a subject ("parcial DE ciberseguridad") is an attempt; saying nothing about one is a
    // general activity, decided, with no question for the student.
    suggestedName = suggestSubjectName(tokens, words.typeCertainty === 'EXACT');
    if (suggestedName) {
      subject = {
        kind: 'UNRESOLVED',
        reason: 'UNKNOWN_NAME',
        candidates: [],
        suggestedName,
        certainty: 'LIKELY',
        origin: 'PARSED',
      };
      blocking.push(
        makeIssue('SUBJECT_UNKNOWN', `La asignatura «${suggestedName}» no existe todavía.`),
      );
    } else {
      subject = { kind: 'NONE', reason: 'NOT_MENTIONED', certainty: 'MISSING', origin: 'DEFAULT' };
    }
  }

  // Title: what the words say; if only the subject's name is left, that name. A subject name that does not exist yet is
  // only OFFERED as a subject: the words stay in the title (the student may answer "sin asignatura", and "Proyecto de
  // grado" must not become "Proyecto").
  let title = words.title;
  let titleCertainty: FieldCertainty = 'EXACT';
  if (title === '' && words.subjectText) {
    title = capitalize(words.subjectText);
    titleCertainty = 'LIKELY';
    warnings.push('TITLE_FROM_SUBJECT');
  }
  if (title === '') {
    blocking.push(makeIssue('TITLE_MISSING'));
    titleCertainty = 'MISSING';
  }
  if (words.warnings.some((w) => w.code === 'TITLE_TRUNCATED')) warnings.push('TITLE_TRUNCATED');

  // Type: only from the rules that exist; no evidence is the usual default, never a blocking question.
  const typeKnown = words.typeCertainty !== 'MISSING';
  if (!typeKnown) warnings.push('TYPE_DEFAULTED');
  return {
    groupId,
    rawSegment: span.rawSegment,
    title: {
      value: title,
      certainty: titleCertainty,
      origin: 'PARSED',
      withoutSubject:
        suggestedName && words.typeCertainty === 'EXACT' ? ACTIVITY_TYPE_LABELS[words.type] : null,
    },
    type: {
      value: words.type,
      certainty: words.typeCertainty,
      origin: typeKnown ? 'PARSED' : 'DEFAULT',
    },
    subject,
    words,
    tokens,
    warnings,
    blocking,
    implicit: span.implicitType !== null,
    description: words.description,
  };
}

const subjectKey = (s: CaptureSubject) =>
  s.kind === 'EXISTING'
    ? s.id
    : s.kind === 'NONE'
      ? 'none'
      : s.suggestedName
        ? `name:${normalizeNameKey(s.suggestedName)}`
        : 'unresolved';

function statusOf(blocking: CaptureProposal['blockingIssues']): CaptureProposal['status'] {
  if (blocking.length === 0) return 'READY';
  return blocking.some((b) => b.code === 'DATE_INVALID' || b.code === 'TITLE_MISSING')
    ? 'INVALID'
    : 'NEEDS_REVIEW';
}

// ───────────────────────── Mentions and references ─────────────────────────

/** One activity the text introduced, with everything its own words said and everything later words added to it. */
/** A mention of an hour, a day or a detail that nobody could own for sure. */
interface PendingReference {
  /** AMBIGUOUS: it could be several activities. ORPHAN: it could be none the engine can name. */
  kind: 'AMBIGUOUS' | 'ORPHAN';
  field: 'date' | 'time' | 'description';
  text: string;
  times: PlannedTime[];
  days: PlannedDay[];
  description: string | null;
}

interface Mention {
  span: DiscourseSpan;
  groupId: string;
  reading: Reading;
  plan: TemporalPlan;
  days: PlannedDay[];
  daysInherited: boolean;
  sharedTime: PlannedTime | null;
  /** "dos tareas": how many activities the words say. */
  count: number | null;
  /** Later words gave this activity a day the first ones did not agree with: all of them, kept for the student. */
  dateConflict: PlannedDay[] | null;
  /**
   * Later words that mention a day, an hour or a piece of context this activity may be the owner of, but that could not be
   * tied to it (or to anyone) with certainty. What they carry is OFFERED to the student, never applied.
   */
  pending: PendingReference[];
  /** What the student said about the activity (its own words, then what later clauses added). */
  description: string | null;
  descriptionFromReference: boolean;
  /** The subject came from a later reference. */
  subjectFromReference: boolean;
  /** It repeats every week (a class, or a repeating activity that cannot be created yet): a suggestion, not a proposal. */
  suggested: boolean;
  recurrence: (typeof RECURRENCE_KINDS)[number] | null;
}

/** The words a noun phrase puts before the activity word ("un", "las dos") and enumerators are not part of the title. */
const ENUMERATOR_NORMS = new Set(['uno', 'una', 'unos', 'unas', 'otro', 'otra', 'otros', 'otras']);

/** Marks what is noise to the reading of ONE span: its noun phrase, enumerators, and words said twice in a row. */
function clearNoise(tokens: Token[], span: DiscourseSpan, entries: SubjectEntry[]): void {
  if ((span.kind === 'TYPE' || span.kind === 'IMPLICIT') && span.anchorIndex > 0) {
    for (let i = span.headIndex; i < span.anchorIndex && i < tokens.length; i++)
      tokens[i]!.used = true;
  }
  if (span.count !== null && span.count > 1) {
    tokens.forEach((t, i) => {
      if (!t.used && ENUMERATOR_NORMS.has(t.norm) && i !== span.anchorIndex) t.used = true;
    });
  }
  // "jueves jueves", "redes redes": a repeated word adds nothing.
  for (let i = 1; i < tokens.length; i++) {
    const [a, b] = [tokens[i - 1]!, tokens[i]!];
    if (!b.used && a.norm === b.norm && b.norm.length > 2 && !/\d/.test(b.norm)) b.used = true;
  }
  // The subject said again later in the same stretch ("parcial de redes ... el de redes").
  const found = matchSubject(tokens, entries);
  if (found.kind === 'match' && found.length >= 1) {
    const seq = tokens.slice(found.start, found.start + found.length).map((t) => t.norm);
    for (let j = 0; j + seq.length <= tokens.length; j++) {
      if (j >= found.start && j < found.start + found.length) continue;
      const same = seq.every((n, k) => !tokens[j + k]!.used && tokens[j + k]!.norm === n);
      if (same) for (let k = 0; k < seq.length; k++) tokens[j + k]!.used = true;
    }
  }
}

const sameExpr = (a: PlannedDay, b: PlannedDay) =>
  JSON.stringify(a.expr) === JSON.stringify(b.expr);
const sameTime = (a: PlannedTime, b: PlannedTime) =>
  a.value === b.value && a.alternatives.join('/') === b.alternatives.join('/');

/** Gives a day the time a later clause said; if it already had a different one, both are kept for the student. */
function giveTime(day: PlannedDay, time: PlannedTime, spanIndex: number): void {
  const incoming: PlannedTime = { ...time, key: `r${spanIndex}:t${time.item}` };
  if (day.time === null && day.timeIssue === null) {
    day.time = incoming;
    day.timeVia = 'DIRECT';
    day.fromReference = { ...day.fromReference, time: true };
  } else if (day.time !== null && !sameTime(day.time, incoming)) {
    day.timeConflict = [...(day.timeConflict ?? [day.time]), incoming];
  }
}

/**
 * A reference ("el parcial es a las 7", "las dos tareas a las 8", "el ensayo es el lunes") adds what it says to the
 * activities it refers to. What already agrees changes nothing; what disagrees is NOT chosen between: both readings are
 * kept and the proposal asks. Nothing here invents a day or a time.
 */
function applyReference(
  targets: Mention[],
  plan: TemporalPlan,
  subject: { id: string; exact: boolean } | null,
  description: string | null,
  spanIndex: number,
  ctx: QuickCaptureContext,
): void {
  for (const m of targets) {
    if (description) {
      // Context adds up: what was said before and what a later clause adds are both the student's words.
      if (m.description === null) m.description = description;
      else if (!m.description.includes(description))
        m.description = `${m.description}. ${description}`;
      m.descriptionFromReference = true;
    }
    if (subject && m.reading.subject.kind === 'NONE') {
      const found = ctx.subjects.find((s) => s.id === subject.id);
      if (found) {
        m.reading.subject = {
          kind: 'EXISTING',
          id: found.id,
          name: found.name,
          certainty: subject.exact ? 'EXACT' : 'LIKELY',
          origin: 'REFERENCE',
        };
        m.subjectFromReference = true;
      }
    }

    for (const rd of plan.days) {
      if (m.days.length === 0) {
        m.days.push({ ...rd, fromReference: { date: true, time: rd.time !== null } });
        continue;
      }
      const same = m.days.find((d) => sameExpr(d, rd));
      if (same) {
        if (rd.time) giveTime(same, rd.time, spanIndex);
      } else {
        m.dateConflict = [...(m.dateConflict ?? m.days), rd];
      }
    }

    // A time with no day of its own: it goes to the days that have none.
    const loose = plan.timeItems > 0 && plan.days.length === 0 ? plan.times : [];
    if (loose.length === 1 && loose[0]) {
      const time = loose[0];
      if (m.days.length === 0) m.sharedTime ??= { ...time, key: `r${spanIndex}:t${time.item}` };
      for (const d of m.days) giveTime(d, time, spanIndex);
    } else if (loose.length > 1) {
      for (const d of m.days) if (d.time === null) d.timeIssue = 'TIME_COUNT_MISMATCH';
    }
  }
}

// ───────────────────────── Weekly schedule ─────────────────────────

/** Words that only start a sentence about the timetable: never a title or a subject name. */
const SCHEDULE_TITLE_FILLERS = new Set([
  'tengo',
  'tenemos',
  'veo',
  'vemos',
  'hay',
  'clase',
  'clases',
  'horario',
  'horarios',
  'todos',
  'todas',
  'cada',
  'semanal',
  'semanales',
  'semanalmente',
  'sesion',
  'sesiones',
  'estudio',
]);

/**
 * The weekly schedule (or repeating activity) a mention became, read AFTER every reference has added its details (the
 * hours of "la del martes es de 8 a 10"). One slot per weekday; the end of each is only what the student wrote ("de 6 a 8")
 * or a question: a duration is never invented. A class needs a subject (an existing one, a name to create, or a choice);
 * a study session may have none.
 */
function buildRecurrence(
  mention: Mention,
  ctx: QuickCaptureContext,
): Omit<RecurrenceSuggestion, 'clientId'> {
  const { reading, plan, span } = mention;
  const kind = mention.recurrence!;
  const norms = tokenize(span.text).map((t) => t.norm);
  const studies = norms.some(
    (n, i) =>
      (n === 'sesion' || n === 'sesiones') &&
      norms[i + 1] === 'de' &&
      (norms[i + 2] === 'estudio' || norms[i + 2] === 'estudios'),
  );
  const blockType: 'CLASS' | 'STUDY' = studies ? 'STUDY' : 'CLASS';

  const name = reading.tokens
    .filter((t) => !t.used && !STOPWORDS.has(t.norm) && !SCHEDULE_TITLE_FILLERS.has(t.norm))
    .map((t) => t.raw);
  const cleanName = name.length > 0 && name.length <= 4 ? capitalize(name.join(' ')) : '';

  // The subject. A class always has one: a missing one is a question, not a general class.
  let subject: CaptureSubject = reading.subject;
  if (subject.kind === 'NONE' && kind === 'WEEKLY_SCHEDULE') {
    subject =
      blockType === 'STUDY'
        ? subject
        : {
            kind: 'UNRESOLVED',
            reason: 'UNKNOWN_NAME',
            candidates: [],
            suggestedName: cleanName === '' ? null : cleanName,
            certainty: 'LIKELY',
            origin: 'PARSED',
          };
  }
  const label = blockType === 'STUDY' ? 'Estudio' : 'Clase';
  const title =
    kind === 'RECURRING_ACTIVITY_UNSUPPORTED'
      ? reading.title.value
      : subject.kind === 'EXISTING'
        ? subject.name
        : subject.kind === 'UNRESOLVED' && subject.suggestedName
          ? subject.suggestedName
          : cleanName || label;

  const blocking: CaptureProposal['blockingIssues'] = [];
  if (kind === 'WEEKLY_SCHEDULE') {
    if (subject.kind === 'UNRESOLVED') {
      blocking.push(
        subject.reason === 'AMBIGUOUS'
          ? makeIssue('SUBJECT_AMBIGUOUS')
          : makeIssue(
              'SUBJECT_UNKNOWN',
              subject.suggestedName
                ? `La asignatura «${subject.suggestedName}» no existe todavía.`
                : 'Falta la asignatura de esta clase.',
            ),
      );
    }
  }

  // One slot per weekday, in the order written.
  const slots: RecurrenceSuggestion['slots'] = [];
  for (const d of mention.days.filter((x) => x.expr.kind === 'weekday')) {
    const weekday = (d.expr as { weekday: Weekday }).weekday;
    if (slots.some((x) => x.weekday === weekday)) continue;
    const start = d.timeConflict ? null : (d.time ?? mention.sharedTime);
    slots.push({
      weekday,
      time: {
        value: start?.value ?? null,
        certainty: start === null ? 'MISSING' : start.certainty,
        alternatives: start?.alternatives ?? [],
      },
      endTime: {
        value: start?.end?.value ?? null,
        certainty: start?.end ? start.end.certainty : 'MISSING',
        alternatives: [],
      },
    });
  }
  if (kind === 'WEEKLY_SCHEDULE') {
    if (slots.some((x) => x.time.certainty === 'AMBIGUOUS'))
      blocking.push(makeIssue('TIME_AMBIGUOUS'));
    else if (slots.some((x) => x.time.value === null))
      blocking.push(makeIssue('START_TIME_MISSING'));
    if (slots.some((x) => x.endTime.value === null)) blocking.push(makeIssue('END_TIME_MISSING'));
  }

  const missing: RecurrenceSuggestion['missing'] = [];
  if (subject.kind === 'UNRESOLVED') missing.push('subject');
  if (slots.some((x) => x.time.value === null)) missing.push('startTime');
  if (slots.some((x) => x.endTime.value === null)) missing.push('endTime');
  const until = ctx.period?.endDate ?? null;
  if (until === null) missing.push('until');

  const status: RecurrenceSuggestion['status'] =
    kind === 'RECURRING_ACTIVITY_UNSUPPORTED'
      ? 'UNSUPPORTED'
      : blocking.length === 0
        ? 'READY'
        : 'NEEDS_REVIEW';
  return {
    groupId: mention.groupId,
    rawSegment: span.rawSegment,
    kind,
    blockType,
    title: {
      value: title,
      certainty: subject.kind === 'EXISTING' ? 'EXACT' : 'LIKELY',
      origin: 'PARSED',
    },
    subject,
    slots,
    until: {
      value: until,
      certainty: until === null ? 'MISSING' : 'LIKELY',
      origin: plan.recurrence.untilPeriod ? 'INHERITED' : 'DEFAULT',
    },
    evidence: plan.recurrence.evidence,
    missing,
    status,
    selected: status === 'READY',
    blockingIssues: blocking,
  };
}

// ───────────────────────── Engine ─────────────────────────

/**
 * Interprets a text into proposals. Never throws. QUICK reads a short phrase (the whole text is one stretch when no
 * activity word cuts it); INBOX reads a pasted message conservatively (a sentence with no activity yields nothing).
 * At most CAPTURE_MAX_PROPOSALS: more is reported as TOO_MANY_PROPOSALS, never truncated in silence.
 *
 * The text becomes MENTIONS (an activity introduced, with its own days and hours) and REFERENCES (a later clause that
 * adds a day, an hour or a subject to one: "el parcial es a las 7"); references are merged into their mention before
 * any proposal is made, so the student never repeats what was said once. What the words contradict is kept as two
 * readings and asked; what no word settles is left for the student, never guessed.
 */
export function parseCaptureProposals(
  text: string,
  context: QuickCaptureContext,
  mode: CaptureMode = 'QUICK',
): CaptureResult {
  const trimmed = text.trim();
  if (trimmed === '') return emptyResult('EMPTY', 0, CAPTURE_MESSAGES.EMPTY);
  if (trimmed.length > CAPTURE_MAX_LENGTH[mode]) {
    return emptyResult(
      'TOO_LONG',
      trimmed.length,
      mode === 'QUICK' ? CAPTURE_MESSAGES.TOO_LONG_QUICK : CAPTURE_MESSAGES.TOO_LONG_INBOX,
    );
  }

  const entries = buildSubjectEntries(context.subjects);
  // "Tengo 3 actividades…" and "la otra es…" are about the text, not activities: blanked out (offsets stay), never a title.
  const meta = maskMetaText(trimmed);
  let spans = segmentDiscourse(meta.text, context, {
    splitLeading: mode === 'QUICK',
    implicitDetails: mode === 'QUICK',
    scheduleAnchors: mode === 'QUICK',
  });
  // "Tengo 3 actividades para el martes" and nothing else says nothing about WHICH ones: no activity is made up.
  if (spans.length === 0 && mode === 'QUICK' && meta.expected === null) {
    // No activity word: the whole phrase is one activity ("Cumpleaños de Ana martes").
    spans = [
      {
        index: 0,
        sentenceIndex: 0,
        rawSegment: trimmed,
        text: trimmed,
        sharedText: '',
        implicitType: null,
        kind: 'LEADING',
        role: 'INTRO',
        count: null,
        definite: false,
        typeKey: 'leading',
        anchorIndex: -1,
        headIndex: 0,
        anchorLength: 0,
        targets: [],
        ambiguous: false,
        schedule: false,
      },
    ];
  }

  const today = toLocalParts(context.now, context.timeZone).date;
  const suggestions: Omit<RecurrenceSuggestion, 'clientId'>[] = [];
  const mentions: Mention[] = [];
  const bySpan = new Map<number, Mention>();

  // 1. Every introduced activity, with its own words.
  let laterDayContext: { sentence: number; days: PlannedDay[] } | null = null;
  for (const span of spans) {
    if (span.role !== 'INTRO') continue;
    const groupId = `g${mentions.length + 1}`;
    const tokens = tokenize(span.text);
    clearNoise(tokens, span, entries);
    const sharedTokens = span.sharedText === '' ? undefined : tokenize(span.sharedText);
    const plan = planTemporal(tokens);
    const sharedPlan = sharedTokens ? planTemporal(cloneTokens(sharedTokens)) : null;

    // The days: its own, else the ones the rest of the sentence gave ("El martes a las 10 tendremos parcial y quiz").
    let days = plan.days;
    let daysInherited = false;
    // A day written BEFORE this activity's own word ("... y para el jueves tengo un proyecto a las 3") is the context of what
    // follows in the sentence: "y una tarea a las 5" is jueves, not the martes the sentence started with.
    const dayBeforeActivity =
      span.headIndex > 0 &&
      (findDateExpressions(tokenize(span.text))[0]?.match.start ?? Infinity) < span.headIndex;
    if (days.length === 0 && sharedPlan && sharedPlan.days.length > 0) {
      const later =
        laterDayContext && laterDayContext.sentence === span.sentenceIndex
          ? laterDayContext.days
          : null;
      days = (later ?? sharedPlan.days).map((d) => ({
        ...d,
        ...(later ? { time: null, timeIssue: null } : {}),
      }));
      daysInherited = true;
      // "Tengo 3 actividades para el martes: un taller a las 8, un examen a las 2…": the day is shared, the hour is its own.
      const ownTimes = plan.times.filter((t): t is PlannedTime => t !== null);
      if (plan.timeItems === 1 && ownTimes.length === 1) {
        days = days.map((d) => ({ ...d, time: ownTimes[0]!, timeIssue: null }));
      }
    }
    // Only a day this activity wrote itself, before its own word, and only from the second activity of a sentence on (the first one
    // carries the sentence's own day, which the later ones already inherit with its hour), opens a new context. It changes WHICH
    // day is inherited and never makes an activity inherit one that nobody gave it (the inheritance above needs a shared day).
    if (
      !daysInherited &&
      plan.days.length > 0 &&
      dayBeforeActivity &&
      sharedPlan &&
      sharedPlan.days.length > 0
    ) {
      laterDayContext = { sentence: span.sentenceIndex, days: plan.days };
    }
    // A time nobody gave this stretch but the sentence did, once.
    let sharedTime: PlannedTime | null = null;
    if (!daysInherited && plan.timeItems === 0 && sharedPlan && sharedPlan.times.length === 1) {
      sharedTime = sharedPlan.times[0] ?? null;
    }

    const reading = readWords(
      { ...span, cutTitle: span.kind !== 'LEADING' },
      tokens,
      sharedTokens,
      groupId,
      context,
      mode,
    );
    const mention: Mention = {
      span,
      groupId,
      reading,
      plan,
      days,
      daysInherited,
      sharedTime,
      count: span.count,
      dateConflict: null,
      pending: [],
      description: reading.description,
      descriptionFromReference: false,
      subjectFromReference: false,
      suggested: false,
      recurrence: null,
    };

    // It repeats every week: a suggestion, not a pile of one-off activities. Which kind depends on the WORDS: a class (or a
    // plain subject with its days) is a weekly schedule; something that is DUE ("un quiz todos los viernes") repeats but is
    // never turned into a class. Weak evidence ("Redes martes y jueves") stays a plain possibility on the proposals.
    const weekdayDays = days.filter((d) => d.expr.kind === 'weekday');
    if (weekdayDays.length > 0 && !span.kind.startsWith('DETAIL')) {
      const typedActivity = reading.words.typeCertainty === 'EXACT';
      const talksSchedule = span.schedule;
      if (plan.recurrence.strong && typedActivity) {
        mention.recurrence = 'RECURRING_ACTIVITY_UNSUPPORTED';
      } else if (
        !typedActivity &&
        (plan.recurrence.strong ||
          (talksSchedule && (plan.recurrence.plural || weekdayDays.length >= 2)))
      ) {
        mention.recurrence = 'WEEKLY_SCHEDULE';
      }
      mention.suggested = mention.recurrence !== null;
    }
    mentions.push(mention);
    bySpan.set(span.index, mention);
  }

  // 2. The references, in the order written: each adds its day, hour, subject or context to the activity it refers to.
  // What nobody can own for sure is OFFERED to the candidates (never applied, never silently dropped).
  for (const span of spans) {
    if (span.role !== 'REFER') continue;
    const tokens = tokenize(span.text);
    const plan = planTemporal(tokens);
    const found = matchSubject(tokens, entries);
    // The words that only name what is referred to ("las dos tareas", "el parcial") and the subject are not a detail.
    if (span.kind !== 'DETAIL') {
      const end = Math.min(tokens.length, span.anchorIndex + Math.max(span.anchorLength, 1));
      for (let i = span.headIndex; i < end; i++) tokens[i]!.used = true;
    }
    if (found.kind === 'match') {
      for (let i = found.start; i < found.start + found.length; i++) tokens[i]!.used = true;
    }
    const subject = found.kind === 'match' ? { id: found.subject.id, exact: found.exact } : null;
    const description = describeTokens(tokens.filter((t) => !t.used));
    const carriesDate = plan.days.length > 0;
    const carriesTime = plan.timeItems > 0;
    if (!carriesDate && !carriesTime && !subject && !description) continue;
    const targets = span.targets.map((i) => bySpan.get(i)).filter((m): m is Mention => !!m);
    if (span.ambiguous || targets.length === 0) {
      const holders =
        targets.length > 0
          ? targets
          : mentions.filter(
              (m) =>
                m.span.index < span.index &&
                m.span.sentenceIndex ===
                  Math.max(
                    -1,
                    ...mentions
                      .filter((x) => x.span.index < span.index)
                      .map((x) => x.span.sentenceIndex),
                  ),
            );
      const kind = span.ambiguous ? 'AMBIGUOUS' : 'ORPHAN';
      const base = {
        kind,
        text: span.rawSegment,
        times: plan.times.filter((t): t is PlannedTime => t !== null),
        days: plan.days,
        description: null,
      } as const;
      for (const m of holders) {
        if (carriesDate) m.pending.push({ ...base, field: 'date' });
        if (carriesTime) m.pending.push({ ...base, field: 'time' });
        if (description) m.pending.push({ ...base, field: 'description', description });
      }
      continue;
    }
    applyReference(targets, plan, subject, description, span.index, context);
  }

  // 3. Proposals.
  // A day said ONCE for several activities ("el martes: un taller a las 8, un examen a las 2, un proyecto a las 7:30") is ONE
  // date. Resolved with each own hour it would split on the day itself (on a Tuesday at 10 the 8 o'clock one moves to next week
  // while the others stay today), so the DATE of the group is resolved with its earliest certain hour. Only the date: each
  // keeps its own hour. The group is structural (see `sharedDayRoots`), never textual.
  const live = mentions.filter((m) => !m.suggested);
  const roots = sharedDayRoots(
    live.map((m) => ({
      sentence: m.span.sentenceIndex,
      inherited: m.daysInherited,
      days: JSON.stringify(m.days.map((d) => d.expr)),
    })),
  );
  const dayGroupRoot = new Map<Mention, Mention>();
  roots.forEach((root, i) => {
    if (root !== null) dayGroupRoot.set(live[i]!, live[root]!);
  });
  const earliestHourOf = new Map<Mention, PlannedTime>();
  for (const [m, root] of dayGroupRoot) {
    for (const d of m.days) {
      const t = d.time ?? m.sharedTime;
      if (!t || t.value === null || t.certainty === 'AMBIGUOUS') continue;
      const best = earliestHourOf.get(root);
      if (!best || t.value < best.value!) earliestHourOf.set(root, t);
    }
  }
  const drafts: { key: string; draft: Draft }[] = [];
  for (const mention of mentions) {
    if (mention.suggested) {
      suggestions.push(buildRecurrence(mention, context));
      continue;
    }
    const { reading, plan, span } = mention;
    const { words } = reading;
    let days = mention.days;

    if (mode === 'INBOX') {
      const supported =
        days.length > 0 ||
        plan.timeItems > 0 ||
        words.subjectId !== null ||
        words.ambiguities.length > 0 ||
        mention.subjectFromReference ||
        tokenize(span.text).some((t) => ACADEMIC_CUES.has(t.norm));
      if (!supported) continue;
    }

    const timeOf = (d: PlannedDay): PlannedTime | null => d.time ?? mention.sharedTime;
    // The date of a day shared by a group is resolved with the group's earliest hour (see `dayGroupRoot`); each keeps its own hour.
    const hourForDate = (d: PlannedDay): PlannedTime | null =>
      dayGroupRoot.has(mention)
        ? (earliestHourOf.get(dayGroupRoot.get(mention)!) ?? timeOf(d))
        : timeOf(d);
    if (mention.dateConflict) days = mention.dateConflict;
    const resolved = days.length > 0 ? resolveDays(days, today, context, hourForDate) : [];
    const weekdayDays = days.filter((d) => d.expr.kind === 'weekday');
    const possibleRecurrence =
      plan.recurrence.plural ||
      (weekdayDays.length >= 2 &&
        reading.subject.kind === 'EXISTING' &&
        reading.subject.certainty === 'EXACT' &&
        words.typeCertainty === 'MISSING' &&
        !reading.implicit);

    // How many proposals this activity is: one per day; "dos tareas" with one day is two on that day; with the days
    // fewer than the quantity, the ones with no day are asked; with more days than the quantity, the days win.
    const quantity = mention.count !== null && mention.count > 1 ? mention.count : null;
    type Row = { index: number; extra: boolean; copy: number };
    let rows: Row[];
    if (mention.dateConflict) rows = [{ index: -1, extra: false, copy: 0 }];
    else if (days.length === 0) {
      rows = Array.from({ length: quantity ?? 1 }, (_, c) => ({
        index: -1,
        extra: false,
        copy: c,
      }));
    } else if (quantity !== null && days.length === 1) {
      rows = Array.from({ length: quantity }, (_, c) => ({ index: 0, extra: false, copy: c }));
    } else {
      rows = days.map((_, i) => ({ index: i, extra: false, copy: 0 }));
      if (quantity !== null && days.length < quantity) {
        for (let c = days.length; c < quantity; c++) rows.push({ index: -1, extra: true, copy: c });
      }
    }
    const quantityMismatch = quantity !== null && days.length > 1 && days.length !== quantity;
    // Hours that were written in this activity's own words and reached none of its days.
    const timesLost =
      plan.timeItems > 0 &&
      mention.sharedTime === null &&
      !(days.length === 0 && plan.timeItems === 1) &&
      days.every((d) => d.time === null && d.timeIssue === null);

    rows.forEach((row) => {
      const day = row.index >= 0 ? days[row.index]! : null;
      const r = row.index >= 0 ? resolved[row.index] : undefined;
      const blocking = [...reading.blocking];
      const warnings = [...reading.warnings, ...(r?.warnings ?? [])];
      if (quantityMismatch && !row.extra) warnings.push('QUANTITY_DATE_MISMATCH');

      // Date.
      let dateValue: string | null = null;
      let dateCertainty: FieldCertainty = 'MISSING';
      let dateAlternatives: string[] = [];
      if (mention.dateConflict) {
        dateAlternatives = [
          ...new Set(resolved.map((x) => x.date).filter((d): d is DateOnly => d !== null)),
        ];
        dateCertainty = 'AMBIGUOUS';
        blocking.push(makeIssue('CONFLICTING_DATE'));
      } else if (row.extra) {
        blocking.push(
          makeIssue(
            'QUANTITY_DATE_MISMATCH',
            `Dijiste ${quantity} actividades pero solo encontré ${days.length} ${days.length === 1 ? 'fecha' : 'fechas'}.`,
          ),
        );
      } else if (day === null) blocking.push(makeIssue('DATE_MISSING'));
      else if (r!.date === null) {
        blocking.push(makeIssue('DATE_INVALID', `La fecha "${r!.invalidText}" no es válida.`));
      } else {
        dateValue = r!.date;
        dateCertainty = r!.certainty;
      }

      // Time.
      // A time with no day to attach to is not lost: the student only has to say the day.
      const loneTime = plan.timeItems === 1 ? (plan.times[0] ?? null) : null;
      const planned = day === null ? (mention.sharedTime ?? loneTime) : timeOf(day);
      const timeInherited =
        day !== null &&
        (mention.daysInherited || (day.time === null && mention.sharedTime !== null));
      let conflictValues: string[] = [];
      if (day?.timeConflict) {
        conflictValues = [
          ...new Set(day.timeConflict.flatMap((t) => (t.value ? [t.value] : t.alternatives))),
        ];
        blocking.push(makeIssue('CONFLICTING_TIME'));
      } else if (day?.timeIssue === 'TIME_INVALID') {
        blocking.push(
          makeIssue('TIME_INVALID', `La hora "${day.invalidTimeText ?? ''}" no es válida.`),
        );
      } else if (day?.timeIssue) {
        blocking.push(makeIssue(day.timeIssue satisfies TimeIssue));
      } else if (planned?.certainty === 'AMBIGUOUS') {
        blocking.push(makeIssue('TIME_AMBIGUOUS'));
      }
      // Words that mention a day, an hour or a detail this activity may own but nobody could tie to it for sure: only
      // worth asking when it carries what this one lacks. What they say is OFFERED as the choice; nothing is applied
      // until the student says it is this one. A hint that says exactly what could not be resolved.
      let offeredTimes: string[] = [];
      let offeredDates: string[] = [];
      let offeredDescription: string | null = null;
      for (const ref of mention.pending) {
        const ambiguous = ref.kind === 'AMBIGUOUS';
        if (
          ref.field === 'time' &&
          (planned === null || planned.value === null) &&
          offeredTimes.length === 0
        ) {
          offeredTimes = ref.times.flatMap((t) => (t.value ? [t.value] : t.alternatives));
          blocking.push(
            ambiguous
              ? makeIssue(
                  'REFERENCE_AMBIGUOUS',
                  `No quedó claro a qué actividad se refiere «${ref.text}».`,
                  'time',
                )
              : makeIssue(
                  'UNRESOLVED_TIME_REFERENCE',
                  `Mencionaste una hora («${ref.times.map((t) => t.text).join(', ')}»), pero no pude asignarla a esta actividad.`,
                ),
          );
        } else if (ref.field === 'date' && mention.days.length === 0 && offeredDates.length === 0) {
          offeredDates = ref.days
            .map((d) => resolveDate(d.expr, today, null, context, d.text).date)
            .filter((d): d is DateOnly => d !== null);
          blocking.push(
            ambiguous
              ? makeIssue(
                  'REFERENCE_AMBIGUOUS',
                  `No quedó claro a qué actividad se refiere «${ref.text}».`,
                  'date',
                )
              : makeIssue(
                  'UNRESOLVED_DATE_REFERENCE',
                  `Mencionaste una fecha («${ref.days.map((d) => d.text).join(', ')}»), pero no pude asignarla a esta actividad.`,
                ),
          );
        } else if (
          ref.field === 'description' &&
          mention.description === null &&
          offeredDescription === null
        ) {
          offeredDescription = ref.description;
          blocking.push(
            makeIssue(
              'UNRESOLVED_DESCRIPTION_REFERENCE',
              `Mencionaste «${ref.description}», pero no pude saber a qué actividad corresponde.`,
            ),
          );
        }
      }
      // An hour the student wrote inside this activity's own words that ended up on nobody ("a las 8 y a las 10" with no
      // day to share them): it is not an optional hour that was left out, it is one that could not be placed.
      if (timesLost && offeredTimes.length === 0 && !day?.timeConflict && !day?.timeIssue) {
        const written = plan.times.filter((t): t is PlannedTime => t !== null);
        if (written.length === 0) {
          blocking.push(makeIssue('TIME_INVALID', 'La hora escrita no es válida.'));
        } else {
          offeredTimes = written.flatMap((t) => (t.value ? [t.value] : t.alternatives));
          blocking.push(
            makeIssue(
              'UNRESOLVED_TIME_REFERENCE',
              `Mencionaste ${written.length === 1 ? 'una hora' : 'horas'} («${written.map((t) => t.text).join(', ')}»), pero no pude asignarla${written.length === 1 ? '' : 's'} a esta actividad.`,
            ),
          );
        }
      }
      if (offeredDates.length > 0) {
        dateAlternatives = offeredDates;
        dateCertainty = 'AMBIGUOUS';
      }
      const hasTime = !day?.timeConflict && planned !== null && planned.value !== null;

      const planKey = hasTime
        ? planned!.value
        : (day?.timeConflict ? conflictValues : (planned?.alternatives ?? [])).join('/');
      const timeOrigin = day?.fromReference?.time
        ? 'REFERENCE'
        : timeInherited
          ? 'INHERITED'
          : day?.timeVia === 'POSITIONAL'
            ? 'POSITIONAL'
            : 'PARSED';
      const draft: Draft = {
        groupId: reading.groupId,
        status: statusOf(blocking),
        rawSegment: reading.rawSegment,
        title: reading.title,
        type: reading.type,
        subject: reading.subject,
        date: {
          value: dateValue,
          certainty: dateCertainty,
          origin: mention.daysInherited
            ? 'INHERITED'
            : day?.fromReference?.date
              ? 'REFERENCE'
              : 'PARSED',
          alternatives: dateAlternatives,
        },
        time: {
          value: hasTime ? planned!.value : null,
          hasTime,
          certainty:
            day?.timeConflict || offeredTimes.length > 0
              ? 'AMBIGUOUS'
              : planned === null || day?.timeIssue
                ? 'MISSING'
                : planned.certainty,
          origin: timeOrigin,
          alternatives:
            offeredTimes.length > 0
              ? offeredTimes
              : day?.timeConflict
                ? conflictValues
                : (planned?.alternatives ?? []),
          groupKey: planned ? (planned.key ?? `${reading.groupId}:t${planned.item}`) : null,
        },
        description: {
          value: mention.description,
          certainty: mention.description === null ? 'MISSING' : 'LIKELY',
          origin:
            mention.description === null
              ? 'DEFAULT'
              : mention.descriptionFromReference
                ? 'REFERENCE'
                : 'PARSED',
          offered: offeredDescription,
        },
        blockingIssues: blocking,
        warnings: warnings.map(makeWarning),
        possibleRecurrence,
        duplicateOf: null,
      };
      drafts.push({
        draft,
        key: [
          reading.type.value,
          normalizeNameKey(reading.title.value),
          dateValue ?? '',
          planKey,
          subjectKey(reading.subject),
          // "dos tareas" the same day are two activities the student asked for, not one said twice.
          quantity !== null ? `#${reading.groupId}:${row.copy}` : '',
        ].join('|'),
      });
    });
  }

  // The same activity said twice ("martes y martes", two sentences that repeat one reminder) is one.
  const seen = new Set<string>();
  const unique = drafts.filter(({ key }) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const collapsed = drafts.length - unique.length;
  const found = unique.length;
  const characters = trimmed.length;

  const weeklyBlocks = suggestions
    .filter((x) => x.kind === 'WEEKLY_SCHEDULE')
    .reduce((n, x) => n + x.slots.length, 0);
  if (unique.length > CAPTURE_MAX_PROPOSALS || weeklyBlocks > CAPTURE_MAX_BLOCKS) {
    return {
      status: 'TOO_MANY_PROPOSALS',
      proposals: [],
      suggestions: [],
      corrections: [],
      warnings: [{ code: 'TOO_MANY_PROPOSALS', message: CAPTURE_MESSAGES.TOO_MANY_PROPOSALS }],
      stats: { characters, found, collapsed, expected: meta.expected },
    };
  }

  let proposals: CaptureProposal[] = unique.map(({ draft }, index) => ({
    clientId: `p${index + 1}`,
    selected: draft.status === 'READY',
    ...draft,
  }));
  // "Tengo 3 actividades…" and the engine found another number: what was found is real, the rest is NOT invented, and the
  // student is told so before anything is created (nothing is ticked until they look).
  const countWarning =
    meta.expected !== null && proposals.length > 0 && proposals.length !== meta.expected
      ? {
          code: 'COUNT_MISMATCH' as const,
          message:
            proposals.length < meta.expected
              ? `Dijiste que eran ${meta.expected} actividades, pero solo pude identificar ${proposals.length}.`
              : `Dijiste que eran ${meta.expected} actividades, pero identifiqué ${proposals.length}.`,
        }
      : null;
  if (countWarning) {
    proposals = proposals.map((p) => ({
      ...p,
      selected: false,
      status: p.status === 'READY' ? 'NEEDS_REVIEW' : p.status,
      blockingIssues: [...p.blockingIssues, makeIssue('COUNT_MISMATCH', countWarning.message)],
    }));
  }
  const result: CaptureResult = {
    status: 'OK',
    proposals,
    suggestions: suggestions.map((s, i) => ({ clientId: `s${i + 1}`, ...s })),
    corrections: computeCorrections(proposals),
    warnings: countWarning
      ? [countWarning]
      : proposals.length === 0 && suggestions.length === 0
        ? [{ code: 'NO_ACTIVITIES', message: CAPTURE_MESSAGES.NO_ACTIVITIES }]
        : [],
    stats: { characters, found, collapsed, expected: meta.expected },
  };
  return result;
}

/**
 * The questions several proposals share, so the student answers each once: the same missing, ambiguous or unknown
 * subject, and the days that share one ambiguous hour. A question that only one proposal has is not listed (its card
 * asks it).
 */
export function computeCorrections(proposals: readonly CaptureProposal[]): CaptureCorrection[] {
  const bySubject = new Map<string, CaptureCorrection>();
  const byTime = new Map<string, CaptureCorrection>();
  for (const p of proposals) {
    const s = p.subject;
    if (s.kind === 'UNRESOLVED') {
      const key =
        s.reason === 'AMBIGUOUS'
          ? `AMBIGUOUS:${s.candidates
              .map((c) => c.id)
              .sort()
              .join(',')}`
          : `UNKNOWN:${normalizeNameKey(s.suggestedName ?? '')}`;
      const found = bySubject.get(key);
      if (found) found.clientIds.push(p.clientId);
      else
        bySubject.set(key, {
          field: 'subject',
          key,
          clientIds: [p.clientId],
          candidates: s.candidates,
          suggestedName: s.suggestedName,
          alternatives: [],
        });
    }
    if (p.time.certainty === 'AMBIGUOUS' && p.time.groupKey !== null) {
      const found = byTime.get(p.time.groupKey);
      if (found) found.clientIds.push(p.clientId);
      else
        byTime.set(p.time.groupKey, {
          field: 'time',
          key: p.time.groupKey,
          clientIds: [p.clientId],
          candidates: [],
          suggestedName: null,
          alternatives: p.time.alternatives,
        });
    }
  }
  return [...bySubject.values(), ...byTime.values()].filter((c) => c.clientIds.length >= 2);
}

// ───────────────────────── Duplicates against what the student already has ─────────────────────────

export interface ExistingActivityRef {
  id: string;
  title: string;
  type: ActivityType;
  subjectId: string | null;
  dueAt: Date | string;
}

/**
 * Flags the proposals that look like an activity the student already has: same day, same type, a related title and
 * the same subject (a general activity matches a general one). It only warns and unticks; it never blocks. `existing`
 * must already be the student's own activities.
 */
export function markExistingDuplicates(
  proposals: readonly CaptureProposal[],
  existing: readonly ExistingActivityRef[],
  timeZone: string,
): CaptureProposal[] {
  const byDay = new Map<string, ExistingActivityRef[]>();
  for (const a of existing) {
    const day = toLocalParts(a.dueAt, timeZone).date;
    byDay.set(day, [...(byDay.get(day) ?? []), a]);
  }
  return proposals.map((p) => {
    const s = p.subject;
    if (p.date.value === null || s.kind === 'UNRESOLVED') return p;
    const wanted = s.kind === 'EXISTING' ? s.id : null;
    const match = (byDay.get(p.date.value) ?? []).find(
      (a) =>
        a.subjectId === wanted &&
        a.type === p.type.value &&
        titlesAreRelated(a.title, p.title.value),
    );
    if (!match) return p;
    return {
      ...p,
      selected: false,
      duplicateOf: { id: match.id, title: match.title },
      warnings: [...p.warnings, makeWarning('POSSIBLE_DUPLICATE')],
    };
  });
}
