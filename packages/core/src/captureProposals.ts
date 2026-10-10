import { z } from 'zod';
import { normalizeNameKey, periodSchema, type DateOnly } from './academic.js';
import { titlesAreRelated, ACADEMIC_CUES, extractAcademicCandidates } from './academicInbox.js';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, type ActivityType } from './activity.js';
import { addDays, weekdayOf, type Weekday } from './calendar.js';
import {
  FIELD_CERTAINTIES,
  QUICK_CAPTURE_MESSAGES,
  STOPWORDS,
  capitalize,
  cloneTokens,
  interpretWords,
  resolveDate,
  tokenize,
  type FieldCertainty,
  type QuickCaptureContext,
  type Token,
} from './captureShared.js';
import {
  planTemporal,
  type PlannedDay,
  type PlannedTime,
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

export const CAPTURE_MAX_PROPOSALS = 10;
export const CAPTURE_MODES = ['QUICK', 'INBOX'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];
/** Characters a text of each mode may have (a quick phrase vs a pasted message). */
export const CAPTURE_MAX_LENGTH: Record<CaptureMode, number> = { QUICK: 300, INBOX: 5000 };
/** Hard cap of the request body: far above the product limits, only a guard against abuse. */
export const CAPTURE_REQUEST_MAX = 20_000;

export const CAPTURE_MESSAGES = {
  EMPTY: 'Escribe o pega algo para continuar.',
  TOO_LONG_QUICK: 'Este texto parece demasiado largo para Captura rápida.',
  TOO_LONG_INBOX: 'El texto es demasiado largo. Pega únicamente el mensaje académico relevante.',
  TOO_MANY_PROPOSALS: `Encontré más de ${CAPTURE_MAX_PROPOSALS} actividades. Divide el mensaje en dos partes.`,
  NO_ACTIVITIES: 'No encontramos actividades claras en este mensaje.',
} as const;

// ───────────────────────── Shape ─────────────────────────

const certainty = z.enum(FIELD_CERTAINTIES);
/** Where a value came from: the text itself, the rest of the sentence or group, a default, or the student (set by the UI). */
const origin = z.enum(['PARSED', 'INHERITED', 'DEFAULT', 'USER']);
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
] as const;
export type CaptureWarningCode = (typeof CAPTURE_WARNING_CODES)[number];

const issue = z.object({
  code: z.enum(CAPTURE_ISSUE_CODES),
  field: z.enum(['title', 'subject', 'date', 'time']),
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
  title: stringField,
  type: z.object({ value: z.enum(ACTIVITY_TYPES), certainty, origin }),
  subject: captureSubjectSchema,
  date: z.object({ value: z.string().nullable(), certainty, origin }),
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

/** "Todos los martes y jueves": it repeats. Detected and shown; nothing here creates a ScheduleBlock (F1-2e). */
export const recurrenceSuggestionSchema = z.object({
  clientId: z.string(),
  groupId: z.string(),
  rawSegment: z.string(),
  title: stringField,
  subject: captureSubjectSchema,
  slots: z.array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      time: z.object({
        value: z.string().nullable(),
        certainty,
        alternatives: z.array(z.string()),
      }),
    }),
  ),
  /** The period's last day when the text says "este semestre" / "todo el periodo"; null otherwise (never guessed). */
  until: z.object({ value: z.string().nullable(), certainty, origin }),
  /** The words that say it repeats. */
  evidence: z.array(z.string()),
  /** What a weekly block still needs: the end time and the end date are never inferred. */
  missing: z.array(z.enum(['subject', 'startTime', 'endTime', 'until'])),
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
      code: z.enum(['EMPTY', 'TOO_LONG', 'TOO_MANY_PROPOSALS', 'NO_ACTIVITIES']),
      message: z.string(),
    }),
  ),
  stats: z.object({
    characters: z.number().int().nonnegative(),
    /** Activities found before the limit and the duplicate collapse. */
    found: z.number().int().nonnegative(),
    collapsed: z.number().int().nonnegative(),
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
};
const makeIssue = (code: CaptureIssueCode, message = ISSUE_MESSAGES[code]) => ({
  code,
  field: ISSUE_FIELD[code],
  message,
});
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
  stats: { characters, found: 0, collapsed: 0 },
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
}

function readWords(
  candidate: { rawSegment: string; implicitType: ActivityType | null },
  tokens: Token[],
  shared: Token[] | undefined,
  groupId: string,
  mode: CaptureMode,
  ctx: QuickCaptureContext,
): Reading {
  const words = interpretWords(tokens, ctx, {
    flagMultipleTypes: false,
    richTitle: mode === 'INBOX',
    implicitType: candidate.implicitType,
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

  // Title: what the words say; if only the subject's name is left, that name; the type's label when a subject name
  // that does not exist yet was taken out of it.
  let title = words.title;
  let titleCertainty: FieldCertainty = 'EXACT';
  if (suggestedName && words.typeCertainty === 'EXACT') title = ACTIVITY_TYPE_LABELS[words.type];
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
    rawSegment: candidate.rawSegment,
    title: { value: title, certainty: titleCertainty, origin: 'PARSED' },
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
    implicit: candidate.implicitType !== null,
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

/**
 * Interprets a text into proposals. Never throws. QUICK reads a short phrase (the whole text is one stretch when no
 * activity word cuts it); INBOX reads a pasted message conservatively (a sentence with no activity yields nothing).
 * At most CAPTURE_MAX_PROPOSALS: more is reported as TOO_MANY_PROPOSALS, never truncated in silence.
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

  let { candidates } = extractAcademicCandidates(trimmed, context, {
    extendedAnchors: true,
    splitLeading: mode === 'QUICK',
  });
  if (candidates.length === 0 && mode === 'QUICK') {
    candidates = [
      { sentenceIndex: 0, rawSegment: trimmed, text: trimmed, sharedText: '', implicitType: null },
    ];
  }

  const today = toLocalParts(context.now, context.timeZone).date;
  const drafts: { key: string; draft: Draft }[] = [];
  const suggestions: Omit<RecurrenceSuggestion, 'clientId'>[] = [];

  candidates.forEach((candidate, c) => {
    const groupId = `g${c + 1}`;
    const tokens = tokenize(candidate.text);
    const sharedTokens = candidate.sharedText === '' ? undefined : tokenize(candidate.sharedText);
    const plan = planTemporal(tokens);
    const sharedPlan = sharedTokens ? planTemporal(cloneTokens(sharedTokens)) : null;

    // The days: its own, else the ones the rest of the sentence gave ("El martes a las 10 tendremos parcial y quiz").
    let days = plan.days;
    let daysInherited = false;
    if (days.length === 0 && sharedPlan && sharedPlan.days.length > 0) {
      days = sharedPlan.days;
      daysInherited = true;
    }
    // A time nobody gave this stretch but the sentence did, once.
    let sharedTime: PlannedTime | null = null;
    if (!daysInherited && plan.timeItems === 0 && sharedPlan && sharedPlan.times.length === 1) {
      sharedTime = sharedPlan.times[0] ?? null;
    }

    const reading = readWords(candidate, tokens, sharedTokens, groupId, mode, context);
    const { words } = reading;

    if (mode === 'INBOX') {
      const supported =
        days.length > 0 ||
        plan.timeItems > 0 ||
        words.subjectId !== null ||
        words.ambiguities.length > 0 ||
        tokens.some((t) => ACADEMIC_CUES.has(t.norm));
      if (!supported) return;
    }

    // It repeats: a suggestion, not a pile of one-off activities.
    const weekdayDays = days.filter((d) => d.expr.kind === 'weekday');
    if (plan.recurrence.strong && weekdayDays.length > 0) {
      const slots = new Map<Weekday, PlannedTime | null>();
      for (const d of weekdayDays) {
        slots.set((d.expr as { weekday: Weekday }).weekday, d.time);
      }
      const until = plan.recurrence.untilPeriod ? (context.period?.endDate ?? null) : null;
      const missing: RecurrenceSuggestion['missing'] = [];
      if (reading.subject.kind === 'UNRESOLVED') missing.push('subject');
      if ([...slots.values()].some((t) => t === null || t.value === null))
        missing.push('startTime');
      missing.push('endTime');
      if (until === null) missing.push('until');
      suggestions.push({
        groupId,
        rawSegment: candidate.rawSegment,
        title: reading.title,
        subject: reading.subject,
        slots: [...slots.entries()].map(([weekday, t]) => ({
          weekday,
          time: {
            value: t?.value ?? null,
            certainty: t === null ? 'MISSING' : t.certainty,
            alternatives: t?.alternatives ?? [],
          },
        })),
        until: {
          value: until,
          certainty: until === null ? 'MISSING' : 'LIKELY',
          origin: until === null ? 'DEFAULT' : 'INHERITED',
        },
        evidence: plan.recurrence.evidence,
        missing,
      });
      return;
    }

    const timeOf = (d: PlannedDay): PlannedTime | null => d.time ?? sharedTime;
    const resolved = days.length > 0 ? resolveDays(days, today, context, timeOf) : [];
    const possibleRecurrence =
      plan.recurrence.plural ||
      (weekdayDays.length >= 2 &&
        reading.subject.kind === 'EXISTING' &&
        reading.subject.certainty === 'EXACT' &&
        words.typeCertainty === 'MISSING' &&
        !reading.implicit);

    const rows = days.length > 0 ? days : [null];
    rows.forEach((day, i) => {
      const r = resolved[i];
      const blocking = [...reading.blocking];
      const warnings = [...reading.warnings, ...(r?.warnings ?? [])];

      // Date.
      let dateValue: string | null = null;
      let dateCertainty: FieldCertainty = 'MISSING';
      if (day === null) blocking.push(makeIssue('DATE_MISSING'));
      else if (r!.date === null) {
        blocking.push(makeIssue('DATE_INVALID', `La fecha "${r!.invalidText}" no es válida.`));
      } else {
        dateValue = r!.date;
        dateCertainty = r!.certainty;
      }

      // Time.
      const planned = day === null ? null : timeOf(day);
      const timeInherited =
        day !== null && (daysInherited || (day.time === null && sharedTime !== null));
      if (day?.timeIssue === 'TIME_INVALID') {
        blocking.push(
          makeIssue('TIME_INVALID', `La hora "${day.invalidTimeText ?? ''}" no es válida.`),
        );
      } else if (day?.timeIssue) {
        blocking.push(makeIssue(day.timeIssue satisfies TimeIssue));
      } else if (planned?.certainty === 'AMBIGUOUS') {
        blocking.push(makeIssue('TIME_AMBIGUOUS'));
      }
      const hasTime = planned !== null && planned.value !== null;

      const planKey = hasTime ? planned!.value : (planned?.alternatives.join('/') ?? '');
      const draft: Draft = {
        groupId,
        status: statusOf(blocking),
        rawSegment: reading.rawSegment,
        title: reading.title,
        type: reading.type,
        subject: reading.subject,
        date: {
          value: dateValue,
          certainty: dateCertainty,
          origin: daysInherited ? 'INHERITED' : 'PARSED',
        },
        time: {
          value: hasTime ? planned!.value : null,
          hasTime,
          certainty: planned === null || day?.timeIssue ? 'MISSING' : planned.certainty,
          origin: timeInherited ? 'INHERITED' : 'PARSED',
          alternatives: planned?.alternatives ?? [],
          groupKey: planned ? `${groupId}:t${planned.item}` : null,
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
        ].join('|'),
      });
    });
  });

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

  if (unique.length > CAPTURE_MAX_PROPOSALS) {
    return {
      status: 'TOO_MANY_PROPOSALS',
      proposals: [],
      suggestions: [],
      corrections: [],
      warnings: [{ code: 'TOO_MANY_PROPOSALS', message: CAPTURE_MESSAGES.TOO_MANY_PROPOSALS }],
      stats: { characters, found, collapsed },
    };
  }

  const proposals: CaptureProposal[] = unique.map(({ draft }, index) => ({
    clientId: `p${index + 1}`,
    selected: draft.status === 'READY',
    ...draft,
  }));
  const result: CaptureResult = {
    status: 'OK',
    proposals,
    suggestions: suggestions.map((s, i) => ({ clientId: `s${i + 1}`, ...s })),
    corrections: computeCorrections(proposals),
    warnings:
      proposals.length === 0 && suggestions.length === 0
        ? [{ code: 'NO_ACTIVITIES', message: CAPTURE_MESSAGES.NO_ACTIVITIES }]
        : [],
    stats: { characters, found, collapsed },
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
