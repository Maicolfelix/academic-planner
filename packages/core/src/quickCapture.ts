import { z } from 'zod';
import { isRealDateOnly, normalizeNameKey, periodSchema, type DateOnly } from './academic.js';
import {
  ACTIVITY_TITLE_MAX,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  DEFAULT_ACTIVITY_TYPE,
  type ActivityType,
} from './activity.js';
import { addDays, firstWeekdayOnOrAfter, type Weekday } from './calendar.js';
import { dueFromLocal, toLocalParts } from './time.js';

/**
 * QUICK CAPTURE: turns a short phrase ("parcial redes martes 10am") into a PROPOSAL for an Activity.
 *
 * It is a deterministic parser: normalisation, tokenisation, small dictionaries and anchored regular
 * expressions. No AI, no remote service, nothing is stored and nothing is created here: the flow is always
 * CAPTURE -> INTERPRET -> CONFIRM, and only the student's confirmation creates an Activity (through the normal
 * Activity API). `now` is injected so every date rule is testable. See docs/quick-capture.md.
 */

export const QUICK_CAPTURE_MAX_LENGTH = 300;
/** Hard cap of the request body: far above the product limit, only a guard against abuse. */
export const QUICK_CAPTURE_REQUEST_MAX = 2000;

export const QUICK_CAPTURE_MESSAGES = {
  EMPTY: 'Escribe una actividad para continuar.',
  TOO_LONG: 'Este texto parece demasiado largo para Captura rápida.',
  MISSING_SUBJECT: 'No reconocí una asignatura.',
  AMBIGUOUS_SUBJECT: 'Encontré más de una asignatura posible.',
  MISSING_DATE: 'No encontré una fecha.',
  DATE_OUTSIDE_PERIOD: 'La fecha interpretada está fuera del periodo académico actual.',
  PAST_TIME_TODAY: 'La hora indicada ya pasó para hoy.',
  MOVED_TO_NEXT_WEEK: 'La hora de hoy ya pasó: se propuso el mismo día de la próxima semana.',
  PAST_DATE: 'La fecha interpretada ya pasó.',
  MULTIPLE_ACTIVITIES: 'Captura rápida admite una actividad a la vez.',
  TITLE_TRUNCATED: `El título se acortó a ${ACTIVITY_TITLE_MAX} caracteres.`,
} as const;

// ───────────────────────── Result ─────────────────────────

/** Deterministic, never a percentage: how sure the parser is about ONE field. */
export const FIELD_CERTAINTIES = ['EXACT', 'LIKELY', 'AMBIGUOUS', 'MISSING'] as const;
export type FieldCertainty = (typeof FIELD_CERTAINTIES)[number];

export const QUICK_CAPTURE_FIELDS = ['type', 'subject', 'date', 'time'] as const;
export type QuickCaptureField = (typeof QUICK_CAPTURE_FIELDS)[number];

export const QUICK_CAPTURE_WARNING_CODES = [
  'EMPTY',
  'TOO_LONG',
  'MISSING_SUBJECT',
  'AMBIGUOUS_SUBJECT',
  'MISSING_DATE',
  'INVALID_DATE',
  'INVALID_TIME',
  'DATE_OUTSIDE_PERIOD',
  'PAST_TIME_TODAY',
  'MOVED_TO_NEXT_WEEK',
  'PAST_DATE',
  'MULTIPLE_ACTIVITIES',
  'TITLE_TRUNCATED',
] as const;

const subjectRef = z.object({ id: z.uuid(), name: z.string() });
const certainty = z.enum(FIELD_CERTAINTIES);

export const quickCaptureResultSchema = z.object({
  rawText: z.string(),
  /** OK, or why nothing was interpreted. A partial understanding is still OK: the UI asks for the rest. */
  status: z.enum(['OK', 'EMPTY', 'TOO_LONG']),
  /** Type label + the text left over, or that text alone when no type was recognised. */
  title: z.string(),
  /** TASK when none was recognised (see `certainty.type`), exactly like a manually created activity. */
  type: z.enum(ACTIVITY_TYPES),
  subjectId: z.uuid().nullable(),
  dueDate: z.string().nullable(),
  /** HH:mm, 24 hours. null = no time (the activity is due at the end of the day). */
  dueTime: z.string().nullable(),
  hasTime: z.boolean(),
  certainty: z.object({ type: certainty, subject: certainty, date: certainty, time: certainty }),
  recognizedFields: z.array(z.enum(QUICK_CAPTURE_FIELDS)),
  /** Required to create an Activity and not found: title, subject and date. */
  missingFields: z.array(z.enum(['title', 'subject', 'date'])),
  ambiguities: z.array(z.object({ field: z.literal('subject'), candidates: z.array(subjectRef) })),
  warnings: z.array(z.object({ code: z.enum(QUICK_CAPTURE_WARNING_CODES), message: z.string() })),
});

export type QuickCaptureResult = z.infer<typeof quickCaptureResultSchema>;

export interface QuickCaptureContext {
  now: Date;
  timeZone: string;
  /** The user's subjects of the CURRENT period (the caller scopes them; the parser never reads a database). */
  subjects: readonly { id: string; name: string }[];
  period: { startDate: DateOnly; endDate: DateOnly } | null;
}

/** POST /api/quick-capture/parse. Strict: nothing but `text`. */
export const quickCaptureRequestSchema = z.strictObject({
  text: z
    .string({ error: QUICK_CAPTURE_MESSAGES.EMPTY })
    .max(QUICK_CAPTURE_REQUEST_MAX, QUICK_CAPTURE_MESSAGES.TOO_LONG),
});
export type QuickCaptureRequest = z.infer<typeof quickCaptureRequestSchema>;

export const quickCaptureResponseSchema = z.object({
  capture: quickCaptureResultSchema,
  period: periodSchema.nullable(),
});
export type QuickCaptureResponse = z.infer<typeof quickCaptureResponseSchema>;

// ───────────────────────── Dictionaries ─────────────────────────

/**
 * Words (already folded: lowercase, no accents) -> ActivityType. "trabajo" is ambiguous in Spanish (a homework
 * or a big project): it is read as TASK, and "proyecto" is the explicit way to say PROJECT.
 */
export const QUICK_CAPTURE_TYPE_ALIASES: Readonly<Record<string, ActivityType>> = {
  tarea: 'TASK',
  trabajo: 'TASK',
  parcial: 'EXAM',
  examen: 'EXAM',
  quiz: 'QUIZ',
  quizz: 'QUIZ',
  'prueba corta': 'QUIZ',
  proyecto: 'PROJECT',
  exposicion: 'PRESENTATION',
  presentacion: 'PRESENTATION',
  taller: 'WORKSHOP',
  lectura: 'READING',
  otro: 'OTHER',
};

const WEEKDAY_BY_NAME: Readonly<Record<string, Weekday>> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

const MONTH_BY_NAME: Readonly<Record<string, number>> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Connectors that carry no meaning at the edges of a title or of a subject match. */
const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'un',
  'una',
  'y',
  'e',
  'a',
  'al',
  'en',
  'para',
  'por',
  'con',
  'lo',
]);

// ───────────────────────── Tokens ─────────────────────────

interface Token {
  /** As typed (edge punctuation removed): used for the title. */
  raw: string;
  /** Folded: lowercase, no accents; "a.m." -> "am". Used to interpret. */
  norm: string;
  used: boolean;
}

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

function foldToken(raw: string): string {
  return normalizeNameKey(raw)
    .replace(/^(\d{1,2}(?::\d{2})?)([ap])\.?m$/, '$1$2m')
    .replace(/^([ap])\.?m$/, '$1m');
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const raw = part.replace(EDGE_PUNCTUATION, '');
    if (raw === '') continue; // "-", "—", "..." and other lone separators
    tokens.push({ raw, norm: foldToken(raw), used: false });
  }
  // "10 a. m." arrives as three tokens: glue the last two into "am".
  for (let i = tokens.length - 2; i >= 0; i--) {
    const [a, m] = [tokens[i]!, tokens[i + 1]!];
    if (
      (a.norm === 'a' || a.norm === 'p') &&
      m.norm === 'm' &&
      /^\d/.test(tokens[i - 1]?.norm ?? '')
    ) {
      tokens.splice(i, 2, { raw: `${a.raw} ${m.raw}`, norm: `${a.norm}m`, used: false });
    }
  }
  return tokens;
}

const isFree = (t: Token | undefined): t is Token => t !== undefined && !t.used;
const use = (tokens: Token[], from: number, count: number) => {
  for (let i = from; i < from + count; i++) tokens[i]!.used = true;
};

// ───────────────────────── Time ─────────────────────────

interface TimeMatch {
  /** HH:mm, or null when the text looked like a time but is not a valid one. */
  value: string | null;
  text: string;
  start: number;
  length: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function matchTimeAt(tokens: Token[], i: number): TimeMatch | null {
  const t = tokens[i];
  if (!isFree(t)) return null;

  // 10am · 10:30pm · 2pm  (the suffix is glued to the number) · 10 am · 10:30 pm  (the suffix is the next token)
  let parts: { hour: number; minute: number; pm: boolean; length: number } | null = null;
  const glued = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(t.norm);
  if (glued) {
    parts = {
      hour: Number(glued[1]),
      minute: glued[2] === undefined ? 0 : Number(glued[2]),
      pm: glued[3] === 'pm',
      length: 1,
    };
  } else {
    const base = /^(\d{1,2})(?::(\d{2}))?$/.exec(t.norm);
    const suffix = tokens[i + 1];
    if (base && isFree(suffix) && (suffix.norm === 'am' || suffix.norm === 'pm')) {
      parts = {
        hour: Number(base[1]),
        minute: base[2] === undefined ? 0 : Number(base[2]),
        pm: suffix.norm === 'pm',
        length: 2,
      };
    }
  }
  if (parts) {
    const { hour, minute, pm, length } = parts;
    const text = tokens
      .slice(i, i + length)
      .map((x) => x.raw)
      .join(' ');
    if (hour < 1 || hour > 12 || minute > 59) return { value: null, text, start: i, length };
    return { value: `${pad((hour % 12) + (pm ? 12 : 0))}:${pad(minute)}`, text, start: i, length };
  }

  // 10:00 · 14:30  (24 hours)
  const h = /^(\d{1,2}):(\d{2})$/.exec(t.norm);
  if (h) {
    const [hour, minute] = [Number(h[1]), Number(h[2])];
    const valid = hour <= 23 && minute <= 59;
    return {
      value: valid ? `${pad(hour)}:${pad(minute)}` : null,
      text: t.raw,
      start: i,
      length: 1,
    };
  }
  return null;
}

// ───────────────────────── Dates ─────────────────────────

type DateExpression =
  | { kind: 'relative'; offset: 0 | 1 | 2 }
  | { kind: 'weekday'; weekday: Weekday }
  | { kind: 'explicit'; day: number; month: number; year: number | null };

interface DateMatch {
  expr: DateExpression;
  start: number;
  length: number;
}

const YEAR_OF = (raw: string): number => (raw.length === 2 ? 2000 + Number(raw) : Number(raw));

function matchDateAt(tokens: Token[], i: number): DateMatch | null {
  const t = tokens[i];
  if (!isFree(t)) return null;
  const next = (k: number) => (isFree(tokens[i + k]) ? tokens[i + k]!.norm : undefined);

  if (t.norm === 'pasado' && next(1) === 'manana') {
    return { expr: { kind: 'relative', offset: 2 }, start: i, length: 2 };
  }
  if (t.norm === 'hoy') return { expr: { kind: 'relative', offset: 0 }, start: i, length: 1 };
  if (t.norm === 'manana') return { expr: { kind: 'relative', offset: 1 }, start: i, length: 1 };

  const weekday = WEEKDAY_BY_NAME[t.norm];
  if (weekday !== undefined) {
    // "este martes" / "proximo martes" mean the same as "martes": the modifier is just consumed.
    const modifier = isFree(tokens[i - 1]) && ['este', 'proximo'].includes(tokens[i - 1]!.norm);
    return {
      expr: { kind: 'weekday', weekday },
      start: modifier ? i - 1 : i,
      length: modifier ? 2 : 1,
    };
  }

  // 15/10 · 15-10 · 15/10/2026 · 15/10/26   (day first: Colombian format)
  const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?$/.exec(t.norm);
  if (numeric) {
    return {
      expr: {
        kind: 'explicit',
        day: Number(numeric[1]),
        month: Number(numeric[2]),
        year: numeric[3] === undefined ? null : YEAR_OF(numeric[3]),
      },
      start: i,
      length: 1,
    };
  }

  // 10 de octubre · 10 octubre · 10 de octubre de 2026
  if (/^\d{1,2}$/.test(t.norm)) {
    const k = next(1) === 'de' ? 2 : 1;
    const month = MONTH_BY_NAME[next(k) ?? ''];
    if (month !== undefined) {
      let length = k + 1;
      let year: number | null = null;
      const afterDe = next(length) === 'de' ? length + 1 : length;
      const y = /^\d{4}$/.exec(next(afterDe) ?? '');
      if (y) {
        year = Number(y[0]);
        length = afterDe + 1;
      }
      return { expr: { kind: 'explicit', day: Number(t.norm), month, year }, start: i, length };
    }
  }

  // octubre 10 · octubre 10 de 2026
  const monthFirst = MONTH_BY_NAME[t.norm];
  if (monthFirst !== undefined && /^\d{1,2}$/.test(next(1) ?? '')) {
    let length = 2;
    let year: number | null = null;
    const afterDe = next(length) === 'de' ? length + 1 : length;
    const y = /^\d{4}$/.exec(next(afterDe) ?? '');
    if (y) {
      year = Number(y[0]);
      length = afterDe + 1;
    }
    return {
      expr: { kind: 'explicit', day: Number(next(1)), month: monthFirst, year },
      start: i,
      length,
    };
  }
  return null;
}

const ymd = (year: number, month: number, day: number): DateOnly =>
  `${year}-${pad(month)}-${pad(day)}`;

interface ResolvedDate {
  date: DateOnly | null;
  certainty: FieldCertainty;
  invalidText?: string;
  movedToNextWeek?: boolean;
}

function resolveDate(
  expr: DateExpression,
  today: DateOnly,
  time: string | null,
  ctx: Pick<QuickCaptureContext, 'now' | 'timeZone'>,
  matchedText: string,
): ResolvedDate {
  switch (expr.kind) {
    case 'relative':
      return { date: addDays(today, expr.offset), certainty: 'EXACT' };
    case 'weekday': {
      // The NEXT occurrence of that day, today included ...
      let date = firstWeekdayOnOrAfter(today, expr.weekday);
      // ... unless it is today and the time written for it has already passed: then the student most likely
      // meant the same day of next week. Without a time, "martes" on a Tuesday means today.
      let movedToNextWeek = false;
      if (
        date === today &&
        time !== null &&
        dueFromLocal({ date, time }, ctx.timeZone).dueAt < ctx.now
      ) {
        date = addDays(date, 7);
        movedToNextWeek = true;
      }
      return { date, certainty: 'LIKELY', movedToNextWeek };
    }
    case 'explicit': {
      if (expr.year !== null) {
        const date = ymd(expr.year, expr.month, expr.day);
        return isRealDateOnly(date)
          ? { date, certainty: 'EXACT' }
          : { date: null, certainty: 'MISSING', invalidText: matchedText };
      }
      // No year: the next occurrence of that day and month, today included.
      const startYear = Number(today.slice(0, 4));
      for (let year = startYear; year <= startYear + 4; year++) {
        const date = ymd(year, expr.month, expr.day);
        if (isRealDateOnly(date) && date >= today) return { date, certainty: 'LIKELY' };
      }
      return { date: null, certainty: 'MISSING', invalidText: matchedText };
    }
  }
}

// ───────────────────────── Subjects ─────────────────────────

interface SubjectEntry {
  id: string;
  name: string;
  norm: string;
  tokens: string[];
}

type SubjectMatch =
  | { kind: 'none' }
  | { kind: 'match'; subject: SubjectEntry; exact: boolean; start: number; length: number }
  | { kind: 'ambiguous'; candidates: SubjectEntry[]; start: number; length: number };

const subjectTokens = (norm: string) => norm.split(/[^a-z0-9]+/).filter(Boolean);

/** A run of consecutive, not yet used tokens: [start, end). */
function freeRuns(tokens: Token[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  tokens.forEach((t, i) => {
    if (!t.used && start < 0) start = i;
    if (t.used && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, tokens.length]);
  return runs;
}

const MAX_PREFIX_WINDOW = 4;
const MIN_PREFIX_LENGTH = 3;

/**
 * Subject matching, in this order of preference (no fuzzy matching: a wrong subject is worse than none):
 *  1. the full normalised name appears (EXACT);
 *  2. the longest run of words whose every word is a word, or an unambiguous prefix of at least 3 letters, of a
 *     subject's name. One subject left -> LIKELY; several -> AMBIGUOUS, never an arbitrary pick.
 * A lone word that is a type word ("proyecto") never selects a subject by itself, so "proyecto redes" is a
 * project of Redes, not a subject called "Proyecto Integrador".
 */
function matchSubject(tokens: Token[], subjects: SubjectEntry[]): SubjectMatch {
  if (subjects.length === 0) return { kind: 'none' };
  const runs = freeRuns(tokens);

  // 1. Exact normalised name, longest first.
  const maxName = Math.min(12, Math.max(...subjects.map((s) => s.tokens.length)));
  for (let length = maxName; length >= 1; length--) {
    for (const [from, to] of runs) {
      for (let start = from; start + length <= to; start++) {
        const joined = tokens
          .slice(start, start + length)
          .map((t) => t.norm)
          .join(' ');
        const hits = subjects.filter((s) => s.norm === joined);
        if (hits.length === 1)
          return { kind: 'match', subject: hits[0]!, exact: true, start, length };
        if (hits.length > 1) return { kind: 'ambiguous', candidates: hits, start, length };
      }
    }
  }

  // 2. Words / unambiguous prefixes.
  for (let length = MAX_PREFIX_WINDOW; length >= 1; length--) {
    const found: { start: number; candidates: SubjectEntry[] }[] = [];
    for (const [from, to] of runs) {
      for (let start = from; start + length <= to; start++) {
        const window = tokens.slice(start, start + length).map((t) => t.norm);
        if (STOPWORDS.has(window[0]!) || STOPWORDS.has(window.at(-1)!)) continue;
        if (
          length === 1 &&
          (window[0]!.length < MIN_PREFIX_LENGTH || window[0]! in QUICK_CAPTURE_TYPE_ALIASES)
        ) {
          continue;
        }
        const candidates = subjects.filter((s) =>
          window.every(
            (w) =>
              s.tokens.includes(w) ||
              (w.length >= MIN_PREFIX_LENGTH && s.tokens.some((st) => st.startsWith(w))),
          ),
        );
        if (candidates.length > 0) found.push({ start, candidates });
      }
    }
    if (found.length === 0) continue;
    const union = new Map<string, SubjectEntry>();
    for (const f of found) for (const c of f.candidates) union.set(c.id, c);
    const first = found[0]!;
    return union.size === 1
      ? {
          kind: 'match',
          subject: [...union.values()][0]!,
          exact: false,
          start: first.start,
          length,
        }
      : { kind: 'ambiguous', candidates: [...union.values()], start: first.start, length };
  }
  return { kind: 'none' };
}

// ───────────────────────── Types ─────────────────────────

function findTypes(tokens: Token[]): { type: ActivityType; start: number; length: number }[] {
  const hits: { type: ActivityType; start: number; length: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isFree(tokens[i])) continue;
    const two = isFree(tokens[i + 1]) ? `${tokens[i]!.norm} ${tokens[i + 1]!.norm}` : '';
    const twoType = QUICK_CAPTURE_TYPE_ALIASES[two];
    if (twoType) {
      hits.push({ type: twoType, start: i, length: 2 });
      i += 1;
      continue;
    }
    const one = QUICK_CAPTURE_TYPE_ALIASES[tokens[i]!.norm];
    if (one) hits.push({ type: one, start: i, length: 1 });
  }
  return hits;
}

// ───────────────────────── Parser ─────────────────────────

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function emptyResult(rawText: string, status: 'EMPTY' | 'TOO_LONG'): QuickCaptureResult {
  return {
    rawText,
    status,
    title: '',
    type: DEFAULT_ACTIVITY_TYPE,
    subjectId: null,
    dueDate: null,
    dueTime: null,
    hasTime: false,
    certainty: { type: 'MISSING', subject: 'MISSING', date: 'MISSING', time: 'MISSING' },
    recognizedFields: [],
    missingFields: ['title', 'subject', 'date'],
    ambiguities: [],
    warnings: [{ code: status, message: QUICK_CAPTURE_MESSAGES[status] }],
  };
}

/**
 * Interprets a short phrase. It never throws and never gives up on partial understanding: it returns what it
 * understood and lists what is missing, so the student completes the rest in the preview.
 *
 * Date rules (all on the user's local calendar, `context.timeZone`):
 *  - "hoy", "mañana", "pasado mañana";
 *  - a weekday name is the NEXT occurrence of that day, today included; if it is today and an explicit time
 *    has already passed, it becomes the same day of next week (without a time it stays today);
 *  - DD/MM, DD-MM and DD/MM/YYYY (day first, never MM/DD) and "10 de octubre" / "10 octubre" / "octubre 10";
 *  - without a year, the next occurrence of that day and month (today included).
 * A date outside the current period is kept and flagged, never silently corrected.
 */
export function parseQuickCapture(input: string, context: QuickCaptureContext): QuickCaptureResult {
  const rawText = input;
  const trimmed = input.trim();
  if (trimmed === '') return emptyResult(rawText, 'EMPTY');
  if (trimmed.length > QUICK_CAPTURE_MAX_LENGTH) return emptyResult(rawText, 'TOO_LONG');

  const warnings: QuickCaptureResult['warnings'] = [];
  const warn = (code: QuickCaptureResult['warnings'][number]['code'], message: string) =>
    warnings.push({ code, message });
  const tokens = tokenize(trimmed);
  const today = toLocalParts(context.now, context.timeZone).date;
  let multiple = false;

  // 1. Time: the first valid one wins; an invalid one ("25:00") is reported and removed from the title.
  let dueTime: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const match = matchTimeAt(tokens, i);
    if (!match) continue;
    let start = match.start;
    let length = match.length;
    // "a las 10am" / "a la 1pm": the connector goes with the time.
    if (isFree(tokens[start - 1]) && ['las', 'la'].includes(tokens[start - 1]!.norm)) {
      start -= 1;
      length += 1;
      if (isFree(tokens[start - 1]) && tokens[start - 1]!.norm === 'a') {
        start -= 1;
        length += 1;
      }
    }
    if (match.value === null) {
      use(tokens, start, length);
      warn('INVALID_TIME', `La hora "${match.text}" no es válida.`);
      continue;
    }
    if (dueTime === null) {
      dueTime = match.value;
      use(tokens, start, length);
    }
  }

  // 2. Date: every date expression is found; the first valid one is used, a different second one means the
  // phrase probably holds more than one activity.
  const dates: { match: DateMatch; text: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = matchDateAt(tokens, i);
    if (!match) continue;
    const text = tokens
      .slice(i, i + match.length)
      .map((t) => t.raw)
      .join(' ');
    dates.push({ match, text });
    i = match.start + match.length - 1; // continue after the expression (a modifier sits BEFORE the weekday)
  }
  let dueDate: DateOnly | null = null;
  let dateCertainty: FieldCertainty = 'MISSING';
  const resolvedDates = dates.map(({ match, text }) => ({
    match,
    text,
    resolved: resolveDate(match.expr, today, dueTime, context, text),
  }));
  for (const { match, text, resolved } of resolvedDates) {
    if (resolved.date === null) {
      use(tokens, match.start, match.length);
      warn('INVALID_DATE', `La fecha "${resolved.invalidText ?? text}" no es válida.`);
      continue;
    }
    if (dueDate === null) {
      dueDate = resolved.date;
      dateCertainty = resolved.certainty;
      use(tokens, match.start, match.length);
      if (resolved.movedToNextWeek)
        warn('MOVED_TO_NEXT_WEEK', QUICK_CAPTURE_MESSAGES.MOVED_TO_NEXT_WEEK);
    } else if (resolved.date === dueDate) {
      use(tokens, match.start, match.length); // the same day said twice ("martes 6/10")
    } else {
      multiple = true; // a second, different date
    }
  }

  // 3. Subject.
  const entries: SubjectEntry[] = context.subjects.map((s) => {
    const norm = normalizeNameKey(s.name);
    return { id: s.id, name: s.name, norm, tokens: subjectTokens(norm) };
  });
  const found = matchSubject(tokens, entries);
  let subjectId: string | null = null;
  let subjectCertainty: FieldCertainty = 'MISSING';
  const ambiguities: QuickCaptureResult['ambiguities'] = [];
  if (found.kind === 'match') {
    subjectId = found.subject.id;
    subjectCertainty = found.exact ? 'EXACT' : 'LIKELY';
    use(tokens, found.start, found.length);
    // A second, different subject that is also clearly named: probably two activities.
    const other = matchSubject(tokens, entries);
    if (other.kind === 'match' && other.subject.id !== subjectId) multiple = true;
  } else if (found.kind === 'ambiguous') {
    subjectCertainty = 'AMBIGUOUS';
    use(tokens, found.start, found.length);
    ambiguities.push({
      field: 'subject',
      candidates: found.candidates
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    });
    warn('AMBIGUOUS_SUBJECT', QUICK_CAPTURE_MESSAGES.AMBIGUOUS_SUBJECT);
  } else {
    warn('MISSING_SUBJECT', QUICK_CAPTURE_MESSAGES.MISSING_SUBJECT);
  }

  // 4. Type: the first alias wins; a different second one means probably two activities.
  const typeHits = findTypes(tokens);
  const first = typeHits[0];
  let type: ActivityType = DEFAULT_ACTIVITY_TYPE;
  let typeCertainty: FieldCertainty = 'MISSING';
  if (first) {
    type = first.type;
    typeCertainty = 'EXACT';
    use(tokens, first.start, first.length);
    if (typeHits.some((h) => h.type !== first.type)) multiple = true;
  }

  // 5. Title: the type's label plus whatever text is left (connectors at the edges removed).
  const rest = tokens.filter((t) => !t.used);
  while (rest.length > 0 && STOPWORDS.has(rest[0]!.norm)) rest.shift();
  while (rest.length > 0 && STOPWORDS.has(rest.at(-1)!.norm)) rest.pop();
  const residual = rest.map((t) => t.raw).join(' ');
  let title = first ? `${ACTIVITY_TYPE_LABELS[type]} ${residual}`.trim() : capitalize(residual);
  if (title.length > ACTIVITY_TITLE_MAX) {
    title = title.slice(0, ACTIVITY_TITLE_MAX).trimEnd();
    warn('TITLE_TRUNCATED', QUICK_CAPTURE_MESSAGES.TITLE_TRUNCATED);
  }

  // 6. Checks that need the context.
  if (dueDate === null) {
    if (!warnings.some((w) => w.code === 'INVALID_DATE'))
      warn('MISSING_DATE', QUICK_CAPTURE_MESSAGES.MISSING_DATE);
  } else {
    if (
      context.period &&
      (dueDate < context.period.startDate || dueDate > context.period.endDate)
    ) {
      warn('DATE_OUTSIDE_PERIOD', QUICK_CAPTURE_MESSAGES.DATE_OUTSIDE_PERIOD);
    }
    if (dueDate < today) {
      warn('PAST_DATE', QUICK_CAPTURE_MESSAGES.PAST_DATE);
    } else if (
      dueDate === today &&
      dueTime !== null &&
      dueFromLocal({ date: dueDate, time: dueTime }, context.timeZone).dueAt < context.now
    ) {
      warn('PAST_TIME_TODAY', QUICK_CAPTURE_MESSAGES.PAST_TIME_TODAY);
    }
  }
  if (multiple) warn('MULTIPLE_ACTIVITIES', QUICK_CAPTURE_MESSAGES.MULTIPLE_ACTIVITIES);

  const timeCertainty: FieldCertainty = dueTime === null ? 'MISSING' : 'EXACT';
  const recognized: QuickCaptureField[] = [];
  if (typeCertainty !== 'MISSING') recognized.push('type');
  if (subjectCertainty === 'EXACT' || subjectCertainty === 'LIKELY') recognized.push('subject');
  if (dueDate !== null) recognized.push('date');
  if (dueTime !== null) recognized.push('time');
  const missingFields: QuickCaptureResult['missingFields'] = [];
  if (title === '') missingFields.push('title');
  if (subjectId === null) missingFields.push('subject');
  if (dueDate === null) missingFields.push('date');

  return {
    rawText,
    status: 'OK',
    title,
    type,
    subjectId,
    dueDate,
    dueTime,
    hasTime: dueTime !== null,
    certainty: {
      type: typeCertainty,
      subject: subjectCertainty,
      date: dateCertainty,
      time: timeCertainty,
    },
    recognizedFields: recognized,
    missingFields,
    ambiguities,
    warnings,
  };
}
