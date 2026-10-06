import { z } from 'zod';
import { dateOnlySchema, normalizeNameKey, type DateOnly } from './academic.js';
import { firstWeekdayOnOrAfter, weekdayOf, type Weekday } from './calendar.js';
import { SCHEDULE_BLOCK_TYPES } from './schedule.js';
import { toLocalParts } from './time.js';

/**
 * Schedule import, the INTERPRETATION half. It works on an intermediate representation (words with their
 * position) and knows nothing about files, OCR engines or PDFs: those live in the API behind a
 * `TextExtractionProvider`. Everything here is pure and deterministic, so it is tested with plain fixtures.
 *
 *   ExtractedDocument -> lines -> layout (table by days | list) -> class candidates -> subject match -> proposals
 */

// ───────────────────────── Limits and messages ─────────────────────────

export const SCHEDULE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const SCHEDULE_IMPORT_MAX_PAGES = 5;
export const SCHEDULE_IMPORT_MAX_PROPOSALS = 40;
export const SCHEDULE_IMPORT_TIMEOUT_MS = 60_000;

export const SCHEDULE_IMPORT_MESSAGES = {
  TOO_LARGE: 'El archivo es demasiado grande.',
  UNSUPPORTED: 'Formato no compatible. Usa una imagen PNG o JPG, o un PDF.',
  TOO_MANY_PAGES: `El PDF tiene demasiadas páginas (máximo ${SCHEDULE_IMPORT_MAX_PAGES}). Sube solo las páginas del horario.`,
  NOTHING_READ: 'No pudimos leer suficiente información del horario.',
  LOW_TEXT: 'La imagen puede estar borrosa o tener poca resolución.',
  TOO_MANY_PROPOSALS: `Encontré más de ${SCHEDULE_IMPORT_MAX_PROPOSALS} clases: muestro las primeras ${SCHEDULE_IMPORT_MAX_PROPOSALS}.`,
  POSSIBLE_DUPLICATE: 'Esta clase parece estar ya en tu agenda.',
  MISSING_END_TIME: 'No se leyó la hora de fin: indícala para importar.',
  MISSING_START_TIME: 'No se leyó la hora de inicio: indícala para importar.',
  MISSING_WEEKDAY: 'No se reconoció el día: elígelo para importar.',
  INVALID_TIME: 'La hora de fin debe ser posterior a la de inicio.',
  SUBJECT_MISSING: 'Asignatura sin reconocer: elige una de tus asignaturas.',
  SUBJECT_AMBIGUOUS: 'Hay varias asignaturas parecidas: elige la correcta.',
  SUBJECT_LIKELY: 'La asignatura no coincide exactamente: confirma la sugerencia.',
  LOW_CONFIDENCE: 'El texto se leyó con poca claridad: revisa los datos.',
  TIMEOUT: 'Procesar el archivo tardó demasiado. Prueba con una imagen más pequeña o más nítida.',
} as const;

// ───────────────────────── Intermediate representation ─────────────────────────

/** A word and where it sits on the page (any unit: pixels or PDF points, with y growing DOWNWARDS). */
export interface ExtractedWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** OCR confidence 0-100 when the engine gives one (never shown as a number). */
  confidence?: number;
}

export interface ExtractedPage {
  page: number;
  words: ExtractedWord[];
}

export type ExtractionMethod = 'PDF_TEXT' | 'OCR';

export interface ExtractedDocument {
  /** Per document: which engine produced the words of each page. */
  pages: (ExtractedPage & { method: ExtractionMethod })[];
}

// ───────────────────────── Days ─────────────────────────

/** Lower case, no accents, no surrounding punctuation. */
export const foldToken = (s: string): string =>
  normalizeNameKey(s).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

const DAY_WORDS: Record<string, Weekday> = {
  lunes: 1,
  lun: 1,
  martes: 2,
  mar: 2,
  miercoles: 3,
  mier: 3,
  mie: 3,
  jueves: 4,
  jue: 4,
  viernes: 5,
  vie: 5,
  sabado: 6,
  sab: 6,
  domingo: 7,
  dom: 7,
};

/** "Miércoles", "mie", "SAB." -> its ISO weekday (1 = Monday); anything else -> null. */
export const parseWeekday = (token: string): Weekday | null => DAY_WORDS[foldToken(token)] ?? null;

// ───────────────────────── Times ─────────────────────────

const MERIDIEM = String.raw`(a\.?\s?m\.?|p\.?\s?m\.?)`;
const CLOCK = String.raw`(\d{1,2})(?:[:.h](\d{2}))?\s*${MERIDIEM}?`;
const SEPARATOR = String.raw`\s*(?:-|–|—|−|a|hasta)\s*`;
const RANGE_RE = new RegExp(String.raw`(?<![\d:.])${CLOCK}${SEPARATOR}${CLOCK}(?![\d:])`, 'i');
const LONE_SOURCE = String.raw`(?<![\d:.])(\d{1,2})(?:[:.h](\d{2})\s*${MERIDIEM}?|\s*${MERIDIEM})(?![\d:])`;
const LONE_RE = new RegExp(LONE_SOURCE, 'i');
/** Every isolated time of a text (global): used to drop the ones that are noise next to a valid range. */
const LONE_ALL_RE = new RegExp(LONE_SOURCE, 'gi');

// A visual calendar prints 24-hour times without a colon on its blocks: "1900-2030", "800-930". Only HHMM / HMM with a
// dash is accepted; a longer digit run is never cut into pieces ("Folio 120045-130045").
const COMPACT_RE = new RegExp(
  String.raw`(?<![\d:.])(\d{3,4})\s*[-–—−]\s*(\d{3,4})(?![\d:]|\.\d)`,
  'g',
);
/** Shortest and longest class a compact range may describe: it keeps "2019-2024" (years) and "207-215" (rooms) out. */
const COMPACT_MIN_MINUTES = 15;
const COMPACT_MAX_MINUTES = 12 * 60;
const COMPACT_EARLIEST_START = 5 * 60;

export interface TimeRange {
  /** HH:mm, 24 h. */
  startTime: string;
  endTime: string;
  /** Where it was found in the text. */
  index: number;
  length: number;
  /** false when a part is not a real time (25:00) or the range is not increasing. */
  valid: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

interface Clock {
  hour: number;
  minute: number;
  meridiem: 'a' | 'p' | null;
  hasMinutes: boolean;
}

const readClock = (h: string, m: string | undefined, mer: string | undefined): Clock => ({
  hour: Number(h),
  minute: m === undefined ? 0 : Number(m),
  meridiem: mer ? (mer[0]!.toLowerCase() as 'a' | 'p') : null,
  hasMinutes: m !== undefined,
});

/** To minutes since midnight, or null when it is not a real time. */
function toMinutes(c: Clock): number | null {
  let hour = c.hour;
  if (c.meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (c.meridiem === 'p' && hour < 12) hour += 12;
    if (c.meridiem === 'a' && hour === 12) hour = 0;
  }
  if (hour > 23 || c.minute > 59) return null;
  return hour * 60 + c.minute;
}

const format = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** "1900" -> 1140 minutes, "930" -> 570. null when it is not a real time of day (2560, 1965). */
function compactMinutes(digits: string): number | null {
  const hour = Number(digits.slice(0, -2));
  const minute = Number(digits.slice(-2));
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

/**
 * The first compact range of a text ("1900-2030", "0800–0930"). Both ends must be real times, the start a plausible class
 * hour and the span a plausible class length; anything else ("2560-2700", "1965-2030", "2019-2024") is not a time at all
 * and stays in the text untouched.
 */
function parseCompactRange(text: string): TimeRange | null {
  for (const m of text.matchAll(COMPACT_RE)) {
    const start = compactMinutes(m[1]!);
    const end = compactMinutes(m[2]!);
    if (start === null || end === null || start < COMPACT_EARLIEST_START) continue;
    const span = end - start;
    if (span < COMPACT_MIN_MINUTES || span > COMPACT_MAX_MINUTES) continue;
    return {
      startTime: format(start),
      endTime: format(end),
      index: m.index,
      length: m[0].length,
      valid: true,
    };
  }
  return null;
}

/**
 * The first time range of a text: "08:00-10:00", "8:00 – 10:00", "8 a 10", "8:00 a.m. - 10:00 a.m.", "2-4pm", and the
 * compact "1900-2030". A bare "8-10" (no minutes, no am/pm) only counts for plausible class hours (6-23), so "Grupo 1-2"
 * is not a range.
 */
export function parseTimeRange(text: string): TimeRange | null {
  return parseRegularRange(text) ?? parseCompactRange(text);
}

function parseRegularRange(text: string): TimeRange | null {
  const m = RANGE_RE.exec(text);
  if (!m) return null;
  const a = readClock(m[1]!, m[2], m[3]);
  const b = readClock(m[4]!, m[5], m[6]);
  const bare = !a.hasMinutes && !b.hasMinutes && !a.meridiem && !b.meridiem;
  if (bare && (a.hour < 6 || b.hour < 6 || a.hour > 23 || b.hour > 23)) return null;
  // "Aula 12 - 14", "Grupo 8-10": numbers that follow a room or group word are not hours.
  if (
    bare &&
    /(sal[oó]n|aula|sala|lab|grupo|gr|g|bloque|piso|edificio)\.?\s*$/i.test(text.slice(0, m.index))
  )
    return null;
  // "2 - 4pm": the closing am/pm also applies to the opening time when that keeps the range increasing.
  if (!a.meridiem && b.meridiem && a.hour >= 1 && a.hour <= 12) {
    const same = toMinutes({ ...a, meridiem: b.meridiem });
    const end = toMinutes(b);
    a.meridiem =
      same !== null && end !== null && same < end ? b.meridiem : a.hour === 12 ? 'p' : 'a';
  }
  const start = toMinutes(a);
  const end = toMinutes(b);
  const valid = start !== null && end !== null && end > start;
  return {
    startTime: start === null ? '' : format(start),
    endTime: end === null ? '' : format(end),
    index: m.index,
    length: m[0].trimEnd().length,
    valid,
  };
}

/** A single time with minutes or am/pm ("08:00", "7am"): a bare number is never a time. */
export function parseLoneTime(
  text: string,
): { time: string; index: number; length: number } | null {
  const m = LONE_RE.exec(text);
  if (!m) return null;
  const minutes = toMinutes(readClock(m[1]!, m[2], m[3] ?? m[4]));
  return minutes === null
    ? null
    : { time: format(minutes), index: m.index, length: m[0].trimEnd().length };
}

// ───────────────────────── Lines and segments ─────────────────────────

const centerY = (w: ExtractedWord) => w.y + w.height / 2;
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export interface Segment {
  text: string;
  x0: number;
  x1: number;
  cx: number;
  cy: number;
  words: ExtractedWord[];
}

export interface Line {
  text: string;
  cy: number;
  words: ExtractedWord[];
  segments: Segment[];
}

const segmentOf = (words: ExtractedWord[]): Segment => {
  const x0 = Math.min(...words.map((w) => w.x));
  const x1 = Math.max(...words.map((w) => w.x + w.width));
  return {
    text: words.map((w) => w.text).join(' '),
    x0,
    x1,
    cx: (x0 + x1) / 2,
    cy: words.reduce((s, w) => s + centerY(w), 0) / words.length,
    words,
  };
};

/**
 * Words -> lines (top to bottom) -> segments (runs of words close together: a table cell, a time label).
 * A column gap is much wider than a space, so segments keep a table's columns apart.
 */
export function groupIntoLines(words: ExtractedWord[]): { lines: Line[]; wordHeight: number } {
  const real = words.filter((w) => w.text.trim() !== '' && w.width > 0 && w.height > 0);
  const wordHeight = median(real.map((w) => w.height)) || 1;
  const sorted = [...real].sort((a, b) => centerY(a) - centerY(b));

  const rows: ExtractedWord[][] = [];
  for (const w of sorted) {
    const row = rows.at(-1);
    const rowCy = row ? row.reduce((s, r) => s + centerY(r), 0) / row.length : 0;
    if (row && Math.abs(centerY(w) - rowCy) <= wordHeight * 0.6) row.push(w);
    else rows.push([w]);
  }

  const lines = rows.map((row): Line => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    const segments: ExtractedWord[][] = [];
    for (const w of ordered) {
      const cur = segments.at(-1);
      const last = cur?.at(-1);
      if (cur && last && w.x - (last.x + last.width) <= wordHeight * 1.6) cur.push(w);
      else segments.push([w]);
    }
    return {
      text: ordered.map((w) => w.text).join(' '),
      cy: row.reduce((s, r) => s + centerY(r), 0) / row.length,
      words: ordered,
      segments: segments.map(segmentOf),
    };
  });
  return { lines, wordHeight };
}

// ───────────────────────── Cleaning a class label ─────────────────────────

const ROOM_LINE =
  /^(salon|aula|sala|lab|laboratorio|bloque|edificio|piso|room|sede|modalidad|virtual)\b/;
const TEACHER_LINE = /^(prof|profesor|profesora|docente|dr|dra|ing|mg|msc|lic)\b\.?/;
const ROOM_TAIL =
  /\s*[-–—|,(]?\s*(?<![\p{L}\d])(sal[oó]n|aula|sala|lab|laboratorio|bloque|edificio|room)(?![\p{L}\d]).*$/iu;
const COURSE_CODE = /\b[A-Za-z]{2,5}[ -]?\d{3,4}[A-Za-z]?\b\s*[-–—:]?\s*/;
const GROUP_TAG = /\b(grupo|gr|g)\.?\s?\d{1,2}\b/gi;

/** Whether a whole line is information we do not import (room, teacher) or just noise. */
export const isIgnorableLine = (text: string): boolean => {
  const f = normalizeNameKey(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim();
  return f === '' || ROOM_LINE.test(f) || TEACHER_LINE.test(f) || /^[\d\s]+$/.test(f);
};

/** "MAT101 - Cálculo  Salón 301  G2" -> "Cálculo". Rooms, teachers and codes are not subjects. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(ROOM_TAIL, '')
    .replace(COURSE_CODE, '')
    .replace(GROUP_TAG, '')
    .replace(/^[\s\-–—:|•·,.]+|[\s\-–—:|•·,.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────── Class candidates ─────────────────────────

export interface ClassCandidate {
  weekday: Weekday | null;
  startTime: string | null;
  endTime: string | null;
  /** The subject name as read (cleaned). */
  label: string;
  /** The text it came from, for the student to recognise. */
  raw: string;
  page: number;
  /** A time that is not a real time or a range that does not increase. */
  invalidTime: boolean;
  /** OCR was unsure about the words of the label. */
  lowConfidence: boolean;
}

export type Layout = 'TABLE' | 'LIST' | 'UNKNOWN';

const LOW_NAME_CONFIDENCE = 60;
/** Digits are what OCR confuses most (12 -> 17) and a wrong hour is the costliest slip: be stricter with them. */
const LOW_NUMBER_CONFIDENCE = 70;

/** OCR was unsure about the letters of the name or about a number of the time. */
const confidenceOf = (words: ExtractedWord[]): boolean => {
  const known = words.filter((w) => w.confidence !== undefined);
  const letters = known.filter((w) => /\p{L}/u.test(w.text) && !/\d/.test(w.text));
  const nameUnsure =
    letters.length > 0 &&
    letters.reduce((s, w) => s + w.confidence!, 0) / letters.length < LOW_NAME_CONFIDENCE;
  const numberUnsure = known.some(
    (w) => /\d/.test(w.text) && w.confidence! < LOW_NUMBER_CONFIDENCE,
  );
  return nameUnsure || numberUnsure;
};

interface Rangeish {
  startTime: string | null;
  endTime: string | null;
  invalid: boolean;
}

/** Splits the time out of some lines: returns what is left and the range / lone time found. */
function takeTime(lines: string[]): { rest: string[]; time: Rangeish; consumed: boolean } {
  const none: Rangeish = { startTime: null, endTime: null, invalid: false };
  for (let i = 0; i < lines.length; i++) {
    const range = parseTimeRange(lines[i]!);
    if (range) {
      const rest = [...lines];
      rest[i] = `${lines[i]!.slice(0, range.index)} ${lines[i]!.slice(range.index + range.length)}`;
      // A valid range IS the time of the class: isolated times around it ("12pm" from the calendar's hour axis) neither
      // replace it nor stay in the title.
      if (range.valid)
        for (let k = 0; k < rest.length; k++) rest[k] = rest[k]!.replace(LONE_ALL_RE, ' ');
      return {
        rest,
        time: {
          startTime: range.startTime || null,
          endTime: range.endTime || null,
          invalid: !range.valid,
        },
        consumed: true,
      };
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const lone = parseLoneTime(lines[i]!);
    if (lone) {
      const rest = [...lines];
      rest[i] = `${lines[i]!.slice(0, lone.index)} ${lines[i]!.slice(lone.index + lone.length)}`;
      return {
        rest,
        time: { startTime: lone.time, endTime: null, invalid: false },
        consumed: true,
      };
    }
  }
  return { rest: lines, time: none, consumed: false };
}

/** The subject label of some text lines: ignorable lines (room, teacher) dropped, codes and groups removed. */
const labelOf = (lines: string[]): string =>
  cleanLabel(lines.filter((l) => !isIgnorableLine(l)).join(' '));

// ── Format B: a list ("Lunes" / "08:00 - 10:00 Redes") ──

function parseList(pageNo: number, lines: Line[]): ClassCandidate[] {
  const out: ClassCandidate[] = [];
  let day: Weekday | null = null;
  // A time read on a line of its own waits for the label that follows it.
  let pending: { time: Rangeish; raw: string; line: Line } | null = null;

  const push = (labelLines: string[], time: Rangeish, raw: string, words: ExtractedWord[]) => {
    const label = labelOf(labelLines);
    if (label === '') return;
    out.push({
      weekday: day,
      startTime: time.startTime,
      endTime: time.endTime,
      label,
      raw: raw.replace(/\s+/g, ' ').trim(),
      page: pageNo,
      invalidTime: time.invalid,
      lowConfidence: confidenceOf(words),
    });
  };

  for (const line of lines) {
    const tokens = line.text.split(/\s+/);
    const firstDay = tokens[0] ? parseWeekday(tokens[0]) : null;
    let text = line.text;
    if (firstDay !== null) {
      day = firstDay;
      pending = null;
      text = tokens
        .slice(1)
        .join(' ')
        .replace(/^[\s:–—-]+/, '');
      if (text.trim() === '') continue;
    }
    const { rest, time, consumed } = takeTime([text]);
    if (consumed) {
      const label = labelOf(rest);
      if (label !== '') {
        push(rest, time, line.text, line.words);
        pending = null;
      } else {
        pending = { time, raw: line.text, line };
      }
    } else if (pending && !isIgnorableLine(text)) {
      push([text], pending.time, `${pending.raw} ${text}`, [...pending.line.words, ...line.words]);
      pending = null;
    }
  }
  return out;
}

// ── Format A: a table with the days as columns ──

interface HeaderCol {
  weekday: Weekday;
  x0: number;
  x1: number;
  cx: number;
}

const colDistance = (s: Segment, h: HeaderCol) =>
  Math.min(Math.abs(s.x0 - h.x0), Math.abs(s.cx - h.cx), Math.abs(s.x1 - h.x1));

/** The topmost line that names at least two different days side by side. */
function findHeader(lines: Line[]): { index: number; cols: HeaderCol[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const cols: HeaderCol[] = [];
    for (const w of lines[i]!.words) {
      const weekday = parseWeekday(w.text);
      if (weekday !== null && !cols.some((c) => c.weekday === weekday)) {
        cols.push({ weekday, x0: w.x, x1: w.x + w.width, cx: w.x + w.width / 2 });
      }
    }
    if (cols.length >= 2) return { index: i, cols: cols.sort((a, b) => a.cx - b.cx) };
  }
  return null;
}

interface RowLabel {
  cy: number;
  text: string;
  start: string;
  /** Own end when the label is a range ("08:00 - 10:00"). */
  end: string | null;
  invalid: boolean;
  words: ExtractedWord[];
}

interface CellLine {
  text: string;
  cy: number;
  words: ExtractedWord[];
}

function parseTable(
  pageNo: number,
  lines: Line[],
  header: { index: number; cols: HeaderCol[] },
  wordHeight: number,
): ClassCandidate[] {
  const cols = header.cols;
  const gap =
    cols.length > 1 ? median(cols.slice(1).map((c, i) => c.cx - cols[i]!.cx)) : wordHeight * 10;
  const gutterEdge = cols[0]!.cx - gap / 2;
  const headerCy = lines[header.index]!.cy;

  const rowLabels: RowLabel[] = [];
  const cells = new Map<number, CellLine[]>(); // column index -> lines, top to bottom

  for (const line of lines) {
    if (line.cy <= headerCy + wordHeight * 0.5) continue; // the header itself and anything above it
    for (const seg of line.segments) {
      if (seg.cx < gutterEdge) {
        const range = parseTimeRange(seg.text);
        const lone = parseLoneTime(seg.text);
        if (range) {
          rowLabels.push({
            cy: seg.cy,
            text: seg.text,
            start: range.startTime,
            end: range.endTime || null,
            invalid: !range.valid,
            words: seg.words,
          });
        } else if (lone) {
          rowLabels.push({
            cy: seg.cy,
            text: seg.text,
            start: lone.time,
            end: null,
            invalid: false,
            words: seg.words,
          });
        }
        continue;
      }
      let best = 0;
      cols.forEach((c, i) => {
        if (colDistance(seg, c) < colDistance(seg, cols[best]!)) best = i;
      });
      const list = cells.get(best) ?? [];
      list.push({ text: seg.text, cy: seg.cy, words: seg.words });
      cells.set(best, list);
    }
  }
  for (const list of cells.values()) list.sort((a, b) => a.cy - b.cy);
  rowLabels.sort((a, b) => a.cy - b.cy);

  const out: ClassCandidate[] = [];
  const emit = (
    col: HeaderCol,
    lines: CellLine[],
    time: Rangeish,
    extraRaw = '',
    extraWords: ExtractedWord[] = [],
  ): void => {
    const label = labelOf(lines.map((l) => l.text));
    if (label === '') return;
    const own = takeTime(lines.map((l) => l.text));
    const effective: Rangeish = own.consumed ? own.time : time;
    const labelFromOwn = own.consumed ? labelOf(own.rest) : label;
    if (labelFromOwn === '') return;
    // The label of the table row is part of what was read only when it gave the time: a cell with its own time does not
    // borrow it, so the hour axis ("12pm") does not leak into the text shown to the student nor into its confidence.
    const usesRowLabel = !own.consumed;
    out.push({
      weekday: col.weekday,
      startTime: effective.startTime,
      endTime: effective.endTime,
      label: labelFromOwn,
      raw: `${lines.map((l) => l.text).join(' ')} ${usesRowLabel ? extraRaw : ''}`
        .replace(/\s+/g, ' ')
        .trim(),
      page: pageNo,
      invalidTime: effective.invalid,
      lowConfidence: confidenceOf([
        ...lines.flatMap((l) => l.words),
        ...(usesRowLabel ? extraWords : []),
      ]),
    });
  };

  if (rowLabels.length > 0) {
    // Time labels down the left side: a cell belongs to the last label at or above it.
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const starts = rowLabels.map((r) => toMin(r.start));
    const step = median(
      starts
        .slice(1)
        .map((s, i) => s - starts[i]!)
        .filter((d) => d > 0),
    );
    const rowEnd = (i: number): string | null => {
      const row = rowLabels[i]!;
      if (row.end) return row.end;
      const next = rowLabels[i + 1];
      if (!next) return null;
      const span = toMin(next.start) - toMin(row.start);
      return span > 0 && (step === 0 || span <= step * 1.5) ? next.start : null;
    };

    cols.forEach((col, ci) => {
      const byRow = new Map<number, CellLine[]>();
      for (const line of cells.get(ci) ?? []) {
        let row = -1;
        rowLabels.forEach((r, i) => {
          if (r.cy <= line.cy + wordHeight * 0.6) row = i;
        });
        if (row < 0) continue;
        byRow.set(row, [...(byRow.get(row) ?? []), line]);
      }
      const rows = [...byRow.keys()].sort((a, b) => a - b);
      for (let k = 0; k < rows.length; k++) {
        let last = rows[k]!;
        const first = last;
        const lines = byRow.get(first)!;
        const key = foldToken(labelOf(lines.map((l) => l.text)));
        const ownTime = takeTime(lines.map((l) => l.text)).consumed;
        // The same subject on consecutive rows that touch each other is ONE class (08-09 + 09-10 -> 08-10).
        while (
          !ownTime &&
          k + 1 < rows.length &&
          rows[k + 1] === last + 1 &&
          rowEnd(last) === rowLabels[last + 1]!.start &&
          foldToken(labelOf(byRow.get(last + 1)!.map((l) => l.text))) === key
        ) {
          last = rows[++k]!;
        }
        const row = rowLabels[first]!;
        emit(
          col,
          lines,
          { startTime: row.start, endTime: rowEnd(last), invalid: row.invalid },
          row.text,
          row.words,
        );
      }
    });
    return out;
  }

  // No time column: every cell carries its own time. Cells are the blocks of a column.
  cols.forEach((col, ci) => {
    let block: CellLine[] = [];
    let hasTime = false;
    let timeFirst = false;
    const flush = () => {
      if (block.length > 0) emit(col, block, { startTime: null, endTime: null, invalid: false });
      block = [];
      hasTime = false;
      timeFirst = false;
    };
    let prevCy = -Infinity;
    for (const line of cells.get(ci) ?? []) {
      const isTime = takeTime([line.text]).consumed;
      const tooFar = line.cy - prevCy > wordHeight * 2.4;
      const ignorable = isIgnorableLine(line.text) && !isTime;
      const startsNew =
        block.length > 0 &&
        (tooFar || (isTime && hasTime) || (hasTime && !timeFirst && !ignorable && !isTime));
      if (startsNew) flush();
      if (block.length === 0 && isTime) timeFirst = true;
      if (isTime) hasTime = true;
      block.push(line);
      prevCy = line.cy;
    }
    flush();
  });
  return out;
}

// ───────────────────────── Calendar axis noise ─────────────────────────

/** "12pm", "5pm", "10am" — and the digits OCR confuses in them ("lpm", "Spm"). */
const AXIS_TIME = /^[0-9IlOoSsZz|]{1,2}(?:[:.h][0-9]{2})?\s?(?:a\.?m\.?|p\.?m\.?)$/i;
const AM_PM_ONLY = /^(?:a\.?m\.?|p\.?m\.?)$/i;
const MIN_AXIS_LABELS = 4;

/**
 * Whether a text is the hour axis of a visual calendar ("1pm 2pm 3pm 4pm 5pm pm 7pm E 12pm") and not a class: four or
 * more isolated hours and not a single word of at least three letters. It is structural, so it holds whatever the OCR
 * slips are, and a real title that merely contains a number ("Proyecto 2") has words and is never affected.
 */
export function isCalendarAxisNoise(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.filter((t) => AXIS_TIME.test(t)).length < MIN_AXIS_LABELS) return false;
  const words = tokens.filter(
    (t) => !AXIS_TIME.test(t) && !AM_PM_ONLY.test(t) && (t.match(/\p{L}/gu) ?? []).length >= 3,
  );
  return words.length === 0;
}

// ───────────────────────── Document -> candidates ─────────────────────────

/** Interprets the pages of a document. Returns the candidates, the layout and the amount of text read. */
export function extractClassCandidates(doc: ExtractedDocument): {
  candidates: ClassCandidate[];
  layout: Layout;
  words: number;
} {
  const candidates: ClassCandidate[] = [];
  let layout: Layout = 'UNKNOWN';
  let words = 0;
  for (const page of doc.pages) {
    words += page.words.length;
    const { lines, wordHeight } = groupIntoLines(page.words);
    const header = findHeader(lines);
    const found = header
      ? parseTable(page.page, lines, header, wordHeight)
      : parseList(page.page, lines);
    const classes = found.filter((c) => !isCalendarAxisNoise(c.raw));
    if (classes.length > 0 && layout === 'UNKNOWN') layout = header ? 'TABLE' : 'LIST';
    candidates.push(...classes);
  }
  // The same class read twice (e.g. repeated on two pages) counts once.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = [c.weekday, c.startTime, c.endTime, foldToken(c.label)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { candidates: unique, layout, words };
}

// ───────────────────────── Subject matching ─────────────────────────

export type SubjectMatchStatus = 'EXACT' | 'LIKELY' | 'AMBIGUOUS' | 'MISSING';

export interface SubjectRef {
  id: string;
  name: string;
}

export interface SubjectMatch {
  status: SubjectMatchStatus;
  /** The subject when EXACT, or the single suggestion when LIKELY (never applied without confirmation). */
  subjectId: string | null;
  candidates: SubjectRef[];
}

const nameWords = (s: string) =>
  normalizeNameKey(s)
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = keep;
    }
  }
  return prev[b.length]!;
}

/** Common OCR slips: "rn" for "m", "vv" for "w", digits for letters. */
const ocrVariants = (q: string): string[] => {
  const variants = new Set([q, q.replace(/rn/g, 'm')]);
  variants.add(q.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's'));
  return [...variants];
};

const FUZZY_MAX_RATIO = 0.25;
const FUZZY_MIN_LENGTH = 4;

/**
 * Subject of a label, never guessed:
 *  - EXACT: the same name once normalised (accents and case ignored), or the label contains the whole name;
 *  - LIKELY: the label is the start of ONE name ("Redes" / "Redes de Computadores") or is one slip away
 *    ("Redcs"): shown as "¿Quisiste decir…?" and never applied on its own;
 *  - AMBIGUOUS: several names fit equally well: the student chooses;
 *  - MISSING: nothing fits. A subject is never created.
 */
export function matchSubject(label: string, subjects: readonly SubjectRef[]): SubjectMatch {
  const q = nameWords(label);
  const none: SubjectMatch = { status: 'MISSING', subjectId: null, candidates: [] };
  if (q.length < 2 || subjects.length === 0) return none;

  const named = subjects.map((s) => ({ s, n: nameWords(s.name) }));
  const result = (status: SubjectMatchStatus, hits: SubjectRef[]): SubjectMatch => ({
    status: hits.length === 1 ? status : 'AMBIGUOUS',
    subjectId: hits.length === 1 ? hits[0]!.id : null,
    candidates: hits,
  });

  const equal = named.filter(({ n }) => n === q).map((x) => x.s);
  if (equal.length > 0) return result('EXACT', equal);

  const contained = named.filter(({ n }) => n.length >= 3 && ` ${q} `.includes(` ${n} `));
  if (contained.length > 0) {
    const longest = Math.max(...contained.map(({ n }) => n.length));
    return result(
      'EXACT',
      contained.filter(({ n }) => n.length === longest).map((x) => x.s),
    );
  }

  if (q.length >= 3) {
    const prefix = named.filter(({ n }) => n.startsWith(`${q} `));
    if (prefix.length > 0)
      return result(
        'LIKELY',
        prefix.map((x) => x.s),
      );
  }

  if (q.length >= FUZZY_MIN_LENGTH) {
    const scored = named
      .map(({ s, n }) => ({
        s,
        ratio: Math.min(
          ...ocrVariants(q).map((v) => editDistance(v, n) / Math.max(v.length, n.length)),
        ),
      }))
      .filter((x) => x.ratio <= FUZZY_MAX_RATIO)
      .sort((a, b) => a.ratio - b.ratio);
    if (scored.length > 0) {
      // A clearly better match wins; near ties are left to the student.
      const [best, second] = scored;
      if (!second || second.ratio - best!.ratio >= 0.1) return result('LIKELY', [best!.s]);
      return result(
        'LIKELY',
        scored.filter((x) => x.ratio - best!.ratio < 0.1).map((x) => x.s),
      );
    }
  }
  return none;
}

// ───────────────────────── Proposals ─────────────────────────

export const SCHEDULE_IMPORT_WARNING_CODES = [
  'MISSING_WEEKDAY',
  'MISSING_START_TIME',
  'MISSING_END_TIME',
  'INVALID_TIME',
  'SUBJECT_MISSING',
  'SUBJECT_AMBIGUOUS',
  'SUBJECT_LIKELY',
  'LOW_CONFIDENCE',
  'POSSIBLE_DUPLICATE',
] as const;

const warningSchema = z.object({
  code: z.enum(SCHEDULE_IMPORT_WARNING_CODES),
  message: z.string(),
});

const refSchema = z.object({ id: z.uuid(), name: z.string() });

export const scheduleImportProposalSchema = z.object({
  index: z.number().int().nonnegative(),
  /** ISO weekday 1-7; null when it could not be read. */
  weekday: z.number().int().min(1).max(7).nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  type: z.enum(SCHEDULE_BLOCK_TYPES),
  /** The subject, only when it matched EXACTLY. */
  subjectId: z.uuid().nullable(),
  subjectMatch: z.object({
    status: z.enum(['EXACT', 'LIKELY', 'AMBIGUOUS', 'MISSING']),
    suggestedId: z.uuid().nullable(),
    candidates: z.array(refSchema),
  }),
  /** The subject name, or the text as read when no subject matched. */
  title: z.string(),
  /** First occurrence (first such weekday on or after the period start) and where the series ends. */
  date: dateOnlySchema.nullable(),
  recurrence: z.object({ frequency: z.literal('WEEKLY'), until: dateOnlySchema }),
  status: z.enum(['READY', 'REVIEW']),
  missingFields: z.array(z.enum(['subject', 'weekday', 'startTime', 'endTime'])),
  warnings: z.array(warningSchema),
  source: z.object({ page: z.number().int().positive(), rawText: z.string().max(300) }),
  duplicateOf: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  /** Overlaps with existing classes: filled by the API from the Schedule service (a warning, never a block). */
  conflicts: z.array(
    z.object({
      blockId: z.uuid(),
      title: z.string(),
      startAt: z.iso.datetime(),
      endAt: z.iso.datetime(),
      occurrences: z.number().int().positive(),
    }),
  ),
});

export type ScheduleImportProposal = z.infer<typeof scheduleImportProposalSchema>;

export const scheduleImportResultSchema = z.object({
  source: z.object({
    type: z.enum(['IMAGE', 'PDF']),
    pages: z.number().int().positive(),
    /** Native PDF text, OCR, or both (a PDF with some scanned pages). */
    method: z.enum(['PDF_TEXT', 'OCR', 'MIXED']),
  }),
  layout: z.enum(['TABLE', 'LIST', 'UNKNOWN']),
  status: z.enum(['OK', 'NOTHING_FOUND']),
  proposals: z.array(scheduleImportProposalSchema).max(SCHEDULE_IMPORT_MAX_PROPOSALS),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  period: z.object({
    id: z.uuid(),
    name: z.string(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  }),
});

export type ScheduleImportResult = z.infer<typeof scheduleImportResultSchema>;

export interface ScheduleImportContext {
  subjects: readonly SubjectRef[];
  period: { startDate: DateOnly; endDate: DateOnly };
}

const MESSAGE_OF = SCHEDULE_IMPORT_MESSAGES;

/** Candidates -> proposals: matched to the user's subjects, dated by the period, flagged for review. */
export function buildScheduleProposals(
  candidates: readonly ClassCandidate[],
  ctx: ScheduleImportContext,
): Omit<ScheduleImportProposal, 'index'>[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      (a.weekday ?? 9) - (b.weekday ?? 9) ||
      (a.startTime ?? '99').localeCompare(b.startTime ?? '99') ||
      a.page - b.page,
  );
  return ordered.map((c) => {
    const match = matchSubject(c.label, ctx.subjects);
    const exact = match.status === 'EXACT' ? match.subjectId : null;
    const subject = exact ? ctx.subjects.find((s) => s.id === exact) : undefined;

    const missingFields: ScheduleImportProposal['missingFields'] = [];
    const warnings: ScheduleImportProposal['warnings'] = [];
    const warn = (code: (typeof SCHEDULE_IMPORT_WARNING_CODES)[number]) =>
      warnings.push({ code, message: MESSAGE_OF[code] });

    if (!exact) {
      missingFields.push('subject');
      warn(
        match.status === 'MISSING'
          ? 'SUBJECT_MISSING'
          : match.status === 'AMBIGUOUS'
            ? 'SUBJECT_AMBIGUOUS'
            : 'SUBJECT_LIKELY',
      );
    }
    if (c.weekday === null) {
      missingFields.push('weekday');
      warn('MISSING_WEEKDAY');
    }
    if (c.startTime === null) {
      missingFields.push('startTime');
      warn('MISSING_START_TIME');
    }
    if (c.endTime === null) {
      missingFields.push('endTime');
      if (c.startTime !== null) warn('MISSING_END_TIME');
    }
    if (c.invalidTime) warn('INVALID_TIME');
    if (c.lowConfidence) warn('LOW_CONFIDENCE');

    const date = c.weekday === null ? null : firstWeekdayOnOrAfter(ctx.period.startDate, c.weekday);
    return {
      weekday: c.weekday,
      startTime: c.startTime,
      endTime: c.endTime,
      type: 'CLASS' as const,
      subjectId: exact,
      subjectMatch: {
        status: match.status,
        suggestedId:
          match.status === 'LIKELY' && match.candidates.length === 1 ? match.subjectId : null,
        candidates: match.candidates,
      },
      title: subject?.name ?? c.label,
      date,
      recurrence: { frequency: 'WEEKLY' as const, until: ctx.period.endDate },
      status: warnings.length > 0 ? ('REVIEW' as const) : ('READY' as const),
      missingFields,
      warnings,
      source: { page: c.page, rawText: c.raw.slice(0, 300) },
      duplicateOf: null,
      conflicts: [],
    };
  });
}

/**
 * The whole interpretation of a document. `READY` proposals can be imported as they are; `REVIEW` ones need the
 * student to complete something first. Capped at SCHEDULE_IMPORT_MAX_PROPOSALS.
 */
export function parseScheduleDocument(doc: ExtractedDocument, ctx: ScheduleImportContext) {
  const { candidates, layout, words } = extractClassCandidates(doc);
  const all = buildScheduleProposals(candidates, ctx);
  const warnings: { code: string; message: string }[] = [];
  if (all.length > SCHEDULE_IMPORT_MAX_PROPOSALS) {
    warnings.push({ code: 'TOO_MANY_PROPOSALS', message: MESSAGE_OF.TOO_MANY_PROPOSALS });
  }
  const proposals = all
    .slice(0, SCHEDULE_IMPORT_MAX_PROPOSALS)
    .map((p, index) => ({ ...p, index }));
  if (proposals.length === 0) {
    warnings.push({ code: 'NOTHING_READ', message: MESSAGE_OF.NOTHING_READ });
  }
  if (words < 6) warnings.push({ code: 'LOW_TEXT', message: MESSAGE_OF.LOW_TEXT });
  return { layout, proposals, warnings, words };
}

// ───────────────────────── Duplicates ─────────────────────────

export interface ExistingClass {
  id: string;
  title: string;
  type: string;
  subjectId: string | null;
  startAt: Date | string;
  endAt: Date | string;
  /** Weekly series (recurrenceUntil set) or a single block. */
  recurring: boolean;
}

/**
 * "This class is already in the agenda": same subject, same weekday, same start and end time, and a weekly
 * series. It is NOT an overlap with a different class (that is a conflict, reported by the Schedule service).
 */
export function findDuplicateClass(
  proposal: Pick<ScheduleImportProposal, 'subjectId' | 'weekday' | 'startTime' | 'endTime'>,
  existing: readonly ExistingClass[],
  timeZone: string,
): ExistingClass | undefined {
  if (!proposal.subjectId || !proposal.weekday || !proposal.startTime || !proposal.endTime)
    return undefined;
  return existing.find((e) => {
    if (e.type !== 'CLASS' || !e.recurring || e.subjectId !== proposal.subjectId) return false;
    const start = toLocalParts(e.startAt, timeZone);
    const end = toLocalParts(e.endAt, timeZone);
    return (
      weekdayOf(start.date) === proposal.weekday &&
      start.time === proposal.startTime &&
      end.time === proposal.endTime
    );
  });
}
