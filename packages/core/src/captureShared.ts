import { isRealDateOnly, normalizeNameKey, type DateOnly } from './academic.js';
import {
  ACTIVITY_TITLE_MAX,
  ACTIVITY_TYPE_LABELS,
  DEFAULT_ACTIVITY_TYPE,
  type ActivityType,
} from './activity.js';
import { addDays, firstWeekdayOnOrAfter, weekdayOf, type Weekday } from './calendar.js';
import { dueFromLocal, toLocalParts } from './time.js';

/**
 * The building blocks shared by QUICK CAPTURE (a short phrase) and the ACADEMIC INBOX (a pasted message):
 * normalisation and tokens, times, dates, subject matching, type words and `interpretTokens`, the one function
 * that turns the tokens of ONE activity into a proposal. Both features call it, so a date, a time, a subject or a
 * type is understood by exactly the same rules everywhere. Deterministic: no AI, no remote service, `now` injected.
 */

// ───────────────────────── Messages and codes ─────────────────────────

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
  WEEKDAY_MISMATCH: 'El día de la semana no coincide con la fecha escrita: usé la fecha.',
} as const;

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
  'WEEKDAY_MISMATCH',
] as const;
export type CaptureWarningCode = (typeof QUICK_CAPTURE_WARNING_CODES)[number];

export interface CaptureWarning {
  code: CaptureWarningCode;
  message: string;
}

export interface QuickCaptureContext {
  now: Date;
  timeZone: string;
  /** The user's subjects of the CURRENT period (the caller scopes them; the parser never reads a database). */
  subjects: readonly { id: string; name: string }[];
  period: { startDate: DateOnly; endDate: DateOnly } | null;
}

/** What interpreting the words of ONE activity yields. */
export interface Interpretation {
  title: string;
  type: ActivityType;
  subjectId: string | null;
  dueDate: DateOnly | null;
  dueTime: string | null;
  hasTime: boolean;
  certainty: {
    type: FieldCertainty;
    subject: FieldCertainty;
    date: FieldCertainty;
    time: FieldCertainty;
  };
  recognizedFields: QuickCaptureField[];
  /** Required to create an Activity and not found: title, subject and date. */
  missingFields: ('title' | 'subject' | 'date')[];
  ambiguities: { field: 'subject'; candidates: { id: string; name: string }[] }[];
  warnings: CaptureWarning[];
}

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
export const STOPWORDS = new Set([
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

/** "primer parcial" -> 1. Only used when building the richer title of a pasted message. */
const ORDINALS: Readonly<Record<string, number>> = {
  primer: 1,
  primero: 1,
  primera: 1,
  segundo: 2,
  segunda: 2,
  tercer: 3,
  tercero: 3,
  tercera: 3,
  cuarto: 4,
  cuarta: 4,
  quinto: 5,
  quinta: 5,
  sexto: 6,
  sexta: 6,
  septimo: 7,
  septima: 7,
  octavo: 8,
  octava: 8,
  noveno: 9,
  novena: 9,
  decimo: 10,
  decima: 10,
};

/** Words of a pasted message that say nothing about WHAT the activity is: dropped from its title. */
const TITLE_FILLERS = new Set([
  'deben',
  'debemos',
  'debes',
  'deberan',
  'debera',
  'tienen',
  'tenemos',
  'tendremos',
  'tendran',
  'tendra',
  'tengan',
  'haremos',
  'hacemos',
  'realizara',
  'realizaran',
  'realizaremos',
  'realizamos',
  'hay',
  'habra',
  'sera',
  'seran',
  'es',
  'son',
  'estan',
  'esta',
  'se',
  'les',
  'nos',
  'que',
  'recuerdo',
  'recordar',
  'recuerden',
  'recordamos',
  'favor',
  'informo',
  'informamos',
  'comunico',
  'entregar',
  'entrega',
  'entregan',
  'entreguen',
  'entregaremos',
  'entregara',
  'presentar',
  'presentaran',
  'presentaremos',
  'estudiantes',
  'estimados',
  'buenas',
  'buenos',
  'tardes',
  'noches',
  'dias',
  'hola',
  'cordial',
  'saludo',
  'saludos',
  'gracias',
  'ademas',
  'tambien',
  'luego',
  'despues',
  'asimismo',
]);

// ───────────────────────── Tokens ─────────────────────────

export interface Token {
  /** As typed (edge punctuation removed): used for the title. */
  raw: string;
  /** Folded: lowercase, no accents; "a.m." -> "am". Used to interpret. */
  norm: string;
  used: boolean;
  /** Offsets of `raw` in the text that was tokenised (to cut exact fragments back out of it). */
  start: number;
  end: number;
  /** A comma or semicolon separated this token from the previous one. */
  afterBreak: boolean;
}

const EDGE_LEADING = /^[\p{P}\p{S}]+/u;
const EDGE_TRAILING = /[\p{P}\p{S}]+$/u;

function foldToken(raw: string): string {
  return normalizeNameKey(raw)
    .replace(/^(\d{1,2}(?::\d{2})?)([ap])\.?m$/, '$1$2m')
    .replace(/^([ap])\.?m$/, '$1m');
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let previousEnd = 0;
  for (const match of text.matchAll(/[^\s,;]+/g)) {
    const part = match[0];
    const lead = EDGE_LEADING.exec(part)?.[0].length ?? 0;
    const trimmedEnd = part.replace(EDGE_TRAILING, '');
    const raw = trimmedEnd.slice(lead);
    const index = match.index ?? 0;
    const between = text.slice(previousEnd, index);
    previousEnd = index + part.length;
    if (raw === '') continue; // "-", "—", "..." and other lone separators
    tokens.push({
      raw,
      norm: foldToken(raw),
      used: false,
      start: index + lead,
      end: index + lead + raw.length,
      afterBreak: /[,;]/.test(between),
    });
  }
  // "10 a. m." arrives as three tokens: glue the last two into "am".
  for (let i = tokens.length - 2; i >= 0; i--) {
    const [a, m] = [tokens[i]!, tokens[i + 1]!];
    if (
      (a.norm === 'a' || a.norm === 'p') &&
      m.norm === 'm' &&
      /^\d/.test(tokens[i - 1]?.norm ?? '')
    ) {
      tokens.splice(i, 2, {
        raw: `${a.raw} ${m.raw}`,
        norm: `${a.norm}m`,
        used: false,
        start: a.start,
        end: m.end,
        afterBreak: a.afterBreak,
      });
    }
  }
  return tokens;
}

export const isFree = (t: Token | undefined): t is Token => t !== undefined && !t.used;
export const use = (tokens: Token[], from: number, count: number) => {
  for (let i = from; i < from + count; i++) tokens[i]!.used = true;
};
export const cloneTokens = (tokens: readonly Token[]): Token[] =>
  tokens.map((t) => ({ ...t, used: false }));
export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ───────────────────────── Time ─────────────────────────

interface TimeMatch {
  /** HH:mm, or null when the text looked like a time but is not a valid one. */
  value: string | null;
  text: string;
  start: number;
  length: number;
  /** The hour was written without am/pm ("a las 10") and had to be read: 6-23 as written, 1-5 as afternoon. */
  likely?: boolean;
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

  // a las 10 · a la 1   (no am/pm: "a las 10" is 10:00, "a las 2" is 14:00; LIKELY because it had to be read)
  const connector = tokens[i - 1];
  const bare = /^(\d{1,2})$/.exec(t.norm);
  if (bare && isFree(connector) && (connector.norm === 'las' || connector.norm === 'la')) {
    const following = tokens[i + 1]?.norm ?? '';
    const startsADate =
      following in MONTH_BY_NAME ||
      (following === 'de' && (tokens[i + 2]?.norm ?? '') in MONTH_BY_NAME);
    if (!startsADate) {
      const hour = Number(bare[1]);
      const h24 = hour >= 1 && hour <= 5 ? hour + 12 : hour;
      const valid = hour >= 1 && h24 <= 23;
      return {
        value: valid ? `${pad(h24)}:00` : null,
        text: t.raw,
        start: i,
        length: 1,
        likely: true,
      };
    }
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

/** The first valid time wins; an invalid one ("25:00") is reported and removed from the title. */
function detectTime(
  tokens: Token[],
  warn: (w: CaptureWarning) => void,
): { value: string | null; likely: boolean } {
  let dueTime: string | null = null;
  let likely = false;
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
      warn({ code: 'INVALID_TIME', message: `La hora "${match.text}" no es válida.` });
      continue;
    }
    if (dueTime === null) {
      dueTime = match.value;
      likely = match.likely === true;
      use(tokens, start, length);
    }
  }
  return { value: dueTime, likely };
}

// ───────────────────────── Dates ─────────────────────────

type DateExpression =
  | { kind: 'relative'; offset: 0 | 1 | 2 }
  /** `strictlyAfter`: "próximo martes" never means today. "este martes" and a bare "martes" may. */
  | { kind: 'weekday'; weekday: Weekday; strictlyAfter: boolean }
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
    // "este martes" = the next Tuesday, today included. "próximo martes" = the next one AFTER today.
    const before = isFree(tokens[i - 1]) ? tokens[i - 1]!.norm : '';
    const modifier = before === 'este' || before === 'proximo';
    return {
      expr: { kind: 'weekday', weekday, strictlyAfter: before === 'proximo' },
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
      // "próximo martes": the next one after today. Otherwise the NEXT occurrence of that day, today included ...
      let date = firstWeekdayOnOrAfter(
        expr.strictlyAfter ? addDays(today, 1) : today,
        expr.weekday,
      );
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

interface FoundDate {
  match: DateMatch;
  text: string;
  /** "martes 13 de octubre": the weekday written next to an explicit date only qualifies it. */
  weekdayHint?: Weekday;
}

/**
 * Every date expression is found; the first valid one is used. A different second one means the text probably
 * holds more than one activity, except a weekday written right next to an explicit date ("el próximo martes 13
 * de octubre"): that is ONE date, the explicit one wins, and a weekday that does not match it is reported.
 */
function detectDate(
  tokens: Token[],
  time: string | null,
  today: DateOnly,
  ctx: Pick<QuickCaptureContext, 'now' | 'timeZone'>,
  warn: (w: CaptureWarning) => void,
): { date: DateOnly | null; certainty: FieldCertainty; multiple: boolean } {
  const found: FoundDate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = matchDateAt(tokens, i);
    if (!match) continue;
    const text = tokens
      .slice(match.start, match.start + match.length)
      .map((t) => t.raw)
      .join(' ');
    found.push({ match, text });
    i = match.start + match.length - 1; // continue after the expression (a modifier sits BEFORE the weekday)
  }

  const merged: FoundDate[] = [];
  for (let i = 0; i < found.length; i++) {
    const a = found[i]!;
    const b = found[i + 1];
    const adjacent = b !== undefined && b.match.start === a.match.start + a.match.length;
    const pair =
      adjacent &&
      ((a.match.expr.kind === 'weekday' && b.match.expr.kind === 'explicit') ||
        (a.match.expr.kind === 'explicit' && b.match.expr.kind === 'weekday'));
    if (pair) {
      const [weekdayPart, explicitPart] = a.match.expr.kind === 'weekday' ? [a, b] : [b, a];
      merged.push({
        match: {
          expr: explicitPart.match.expr,
          start: a.match.start,
          length: a.match.length + b.match.length,
        },
        text: `${a.text} ${b.text}`,
        weekdayHint: (weekdayPart.match.expr as { weekday: Weekday }).weekday,
      });
      i += 1;
    } else {
      merged.push(a);
    }
  }

  let date: DateOnly | null = null;
  let certainty: FieldCertainty = 'MISSING';
  let multiple = false;
  for (const { match, text, weekdayHint } of merged) {
    const resolved = resolveDate(match.expr, today, time, ctx, text);
    if (resolved.date === null) {
      use(tokens, match.start, match.length);
      warn({
        code: 'INVALID_DATE',
        message: `La fecha "${resolved.invalidText ?? text}" no es válida.`,
      });
      continue;
    }
    if (date === null) {
      date = resolved.date;
      certainty = resolved.certainty;
      use(tokens, match.start, match.length);
      if (resolved.movedToNextWeek) {
        warn({ code: 'MOVED_TO_NEXT_WEEK', message: QUICK_CAPTURE_MESSAGES.MOVED_TO_NEXT_WEEK });
      }
      if (weekdayHint !== undefined && weekdayOf(date) !== weekdayHint) {
        warn({ code: 'WEEKDAY_MISMATCH', message: QUICK_CAPTURE_MESSAGES.WEEKDAY_MISMATCH });
      }
    } else if (resolved.date === date) {
      use(tokens, match.start, match.length); // the same day said twice ("martes 6/10")
    } else {
      multiple = true; // a second, different date
    }
  }
  return { date, certainty, multiple };
}

// ───────────────────────── Subjects ─────────────────────────

export interface SubjectEntry {
  id: string;
  name: string;
  norm: string;
  tokens: string[];
}

export type SubjectMatch =
  | { kind: 'none' }
  | { kind: 'match'; subject: SubjectEntry; exact: boolean; start: number; length: number }
  | { kind: 'ambiguous'; candidates: SubjectEntry[]; start: number; length: number };

const subjectTokens = (norm: string) => norm.split(/[^a-z0-9]+/).filter(Boolean);

export function buildSubjectEntries(
  subjects: readonly { id: string; name: string }[],
): SubjectEntry[] {
  return subjects.map((s) => {
    const norm = normalizeNameKey(s.name);
    return { id: s.id, name: s.name, norm, tokens: subjectTokens(norm) };
  });
}

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
export function matchSubject(tokens: Token[], subjects: SubjectEntry[]): SubjectMatch {
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

export interface TypeHit {
  type: ActivityType;
  start: number;
  length: number;
}

export function findTypes(tokens: Token[]): TypeHit[] {
  const hits: TypeHit[] = [];
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

// ───────────────────────── Interpreting ONE activity ─────────────────────────

export interface InterpretOptions {
  /**
   * Quick capture: a second, different type word means two activities (default true). A pasted message has
   * already been split into one clause per activity, so a later type word there is just part of the wording
   * ("presentación del proyecto").
   */
  flagMultipleTypes?: boolean;
  /** Pasted message: "primer parcial" -> "Parcial 1" and the chatter (deben, tendremos…) leaves the title. */
  richTitle?: boolean;
  /** The type read from wording that is not a type word ("entregar informe"), used when none is written. */
  implicitType?: ActivityType | null;
  /**
   * Words of the same sentence that belong to every activity in it ("El martes a las 10 tendremos parcial y
   * quiz", "En Redes tendremos…"). They only fill what the activity's own words did not say.
   */
  shared?: readonly Token[];
}

export interface InterpretMeta {
  subjectFromShared: boolean;
  dateFromShared: boolean;
  timeFromShared: boolean;
}

export function interpretTokens(
  tokens: Token[],
  context: QuickCaptureContext,
  options: InterpretOptions = {},
): Interpretation & { meta: InterpretMeta } {
  const warnings: CaptureWarning[] = [];
  const warn = (w: CaptureWarning) => warnings.push(w);
  const today = toLocalParts(context.now, context.timeZone).date;
  const meta: InterpretMeta = {
    subjectFromShared: false,
    dateFromShared: false,
    timeFromShared: false,
  };
  let multiple = false;

  // 1. Time: its own, else the shared one.
  const ownTime = detectTime(tokens, warn);
  let dueTime = ownTime.value;
  let timeLikely = ownTime.likely;
  if (dueTime === null && options.shared) {
    const sharedTime = detectTime(cloneTokens(options.shared), () => undefined);
    dueTime = sharedTime.value;
    timeLikely = sharedTime.likely;
    meta.timeFromShared = dueTime !== null;
  }

  // 2. Date: its own, else the shared one.
  const own = detectDate(tokens, dueTime, today, context, warn);
  let dueDate = own.date;
  let dateCertainty = own.certainty;
  if (own.multiple) multiple = true;
  if (dueDate === null && options.shared) {
    const sharedDate = detectDate(
      cloneTokens(options.shared),
      dueTime,
      today,
      context,
      () => undefined,
    );
    if (sharedDate.date !== null) {
      dueDate = sharedDate.date;
      dateCertainty = sharedDate.certainty;
      meta.dateFromShared = true;
    }
  }

  // 3. Subject: its own, else the shared one.
  const entries = buildSubjectEntries(context.subjects);
  let found = matchSubject(tokens, entries);
  let fromShared = false;
  if (found.kind === 'none' && options.shared) {
    const sharedTokens = cloneTokens(options.shared);
    const sharedFound = matchSubject(sharedTokens, entries);
    if (sharedFound.kind !== 'none') {
      found = sharedFound;
      fromShared = true;
    }
  }
  let subjectId: string | null = null;
  let subjectCertainty: FieldCertainty = 'MISSING';
  const ambiguities: Interpretation['ambiguities'] = [];
  if (found.kind === 'match') {
    subjectId = found.subject.id;
    // A subject taken from the rest of the sentence is inferred from context, so it is never EXACT.
    subjectCertainty = found.exact && !fromShared ? 'EXACT' : 'LIKELY';
    if (!fromShared) {
      use(tokens, found.start, found.length);
      // A second, different subject that is also clearly named: probably two activities.
      const other = matchSubject(tokens, entries);
      if (other.kind === 'match' && other.subject.id !== subjectId) multiple = true;
    } else {
      meta.subjectFromShared = true;
    }
  } else if (found.kind === 'ambiguous') {
    subjectCertainty = 'AMBIGUOUS';
    if (!fromShared) use(tokens, found.start, found.length);
    ambiguities.push({
      field: 'subject',
      candidates: found.candidates
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    });
    warn({ code: 'AMBIGUOUS_SUBJECT', message: QUICK_CAPTURE_MESSAGES.AMBIGUOUS_SUBJECT });
  } else {
    warn({ code: 'MISSING_SUBJECT', message: QUICK_CAPTURE_MESSAGES.MISSING_SUBJECT });
  }

  // 4. Type: the first alias wins; a different second one means probably two activities (quick capture only).
  const typeHits = findTypes(tokens);
  const first = typeHits[0];
  let type: ActivityType = DEFAULT_ACTIVITY_TYPE;
  let typeCertainty: FieldCertainty = 'MISSING';
  let ordinal: number | null = null;
  if (first) {
    type = first.type;
    typeCertainty = 'EXACT';
    use(tokens, first.start, first.length);
    if (options.flagMultipleTypes !== false && typeHits.some((h) => h.type !== first.type)) {
      multiple = true;
    }
    if (options.richTitle) {
      // "el primer parcial" / "parcial primero": the number goes to the title.
      for (const i of [first.start - 1, first.start + first.length]) {
        const t = tokens[i];
        if (isFree(t) && t.norm in ORDINALS) {
          ordinal = ORDINALS[t.norm]!;
          t.used = true;
          break;
        }
      }
    }
  } else if (options.implicitType) {
    type = options.implicitType;
    typeCertainty = 'LIKELY';
  }

  // 5. Title: the type's label plus whatever text is left (connectors at the edges removed).
  let rest = tokens.filter((t) => !t.used);
  if (options.richTitle) rest = rest.filter((t) => !TITLE_FILLERS.has(t.norm));
  while (rest.length > 0 && STOPWORDS.has(rest[0]!.norm)) rest.shift();
  while (rest.length > 0 && STOPWORDS.has(rest.at(-1)!.norm)) rest.pop();
  const words = rest.map((t) => t.raw);
  if (ordinal !== null && !/^\d+$/.test(words[0] ?? '')) words.unshift(String(ordinal));
  const residual = words.join(' ');
  let title = first ? `${ACTIVITY_TYPE_LABELS[type]} ${residual}`.trim() : capitalize(residual);
  if (title.length > ACTIVITY_TITLE_MAX) {
    title = title.slice(0, ACTIVITY_TITLE_MAX).trimEnd();
    warn({ code: 'TITLE_TRUNCATED', message: QUICK_CAPTURE_MESSAGES.TITLE_TRUNCATED });
  }

  // 6. Checks that need the context.
  if (dueDate === null) {
    if (!warnings.some((w) => w.code === 'INVALID_DATE')) {
      warn({ code: 'MISSING_DATE', message: QUICK_CAPTURE_MESSAGES.MISSING_DATE });
    }
  } else {
    if (
      context.period &&
      (dueDate < context.period.startDate || dueDate > context.period.endDate)
    ) {
      warn({ code: 'DATE_OUTSIDE_PERIOD', message: QUICK_CAPTURE_MESSAGES.DATE_OUTSIDE_PERIOD });
    }
    if (dueDate < today) {
      warn({ code: 'PAST_DATE', message: QUICK_CAPTURE_MESSAGES.PAST_DATE });
    } else if (
      dueDate === today &&
      dueTime !== null &&
      dueFromLocal({ date: dueDate, time: dueTime }, context.timeZone).dueAt < context.now
    ) {
      warn({ code: 'PAST_TIME_TODAY', message: QUICK_CAPTURE_MESSAGES.PAST_TIME_TODAY });
    }
  }
  if (multiple) {
    warn({ code: 'MULTIPLE_ACTIVITIES', message: QUICK_CAPTURE_MESSAGES.MULTIPLE_ACTIVITIES });
  }

  const timeCertainty: FieldCertainty =
    dueTime === null ? 'MISSING' : timeLikely ? 'LIKELY' : 'EXACT';
  const recognized: QuickCaptureField[] = [];
  if (typeCertainty !== 'MISSING') recognized.push('type');
  if (subjectCertainty === 'EXACT' || subjectCertainty === 'LIKELY') recognized.push('subject');
  if (dueDate !== null) recognized.push('date');
  if (dueTime !== null) recognized.push('time');
  const missingFields: Interpretation['missingFields'] = [];
  if (title === '') missingFields.push('title');
  if (subjectId === null) missingFields.push('subject');
  if (dueDate === null) missingFields.push('date');

  return {
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
    meta,
  };
}
