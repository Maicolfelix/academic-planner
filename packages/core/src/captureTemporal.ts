import type { Weekday } from './calendar.js';
import {
  WEEKDAY_BY_NAME,
  bareTimeAlternatives,
  findDateExpressions,
  isFree,
  matchTimeAt,
  use,
  type DateExpression,
  type Token,
} from './captureShared.js';

/**
 * THE TEMPORAL PLAN: what a stretch of text says about WHEN, before anything is turned into an activity.
 *
 * "Ensayo lunes, martes, jueves y viernes, los dos primeros a las 7:30 am y los otros dos a las 5:40 pm" is not four
 * dates and two times: it is an ORDERED list of days and a time that belongs to some of them by position. The plan keeps
 * exactly that (the days in the order written, the time of each, and which time item it came from) so the engine can
 * make one proposal per day without the student retyping anything. It is small on purpose: one pass over the tokens,
 * a handful of Spanish phrases, no grammar.
 *
 * What it understands:
 *  - a list of days ("lunes, martes y jueves") and a range ("lunes a viernes", "de lunes a viernes");
 *  - a time shared by all of them ("... a las 8"), a time after each run of days ("lunes y martes a las 7, jueves a
 *    las 4"), a time by position ("los dos primeros ... los otros dos ...", "los dos últimos", "el resto") and
 *    "respectivamente" (the times in the order of the days);
 *  - an hour with no am/pm ("a las 6") is AMBIGUOUS (06:00 or 18:00): it is never read as 06:00;
 *  - the words that say it repeats ("todos los martes", "cada martes", "semanal", "este semestre").
 * Whatever cannot be distributed with certainty is NOT guessed: the affected days carry an issue instead of a time.
 */

export type TimeIssue = 'TIME_INVALID' | 'TIME_UNASSIGNED' | 'TIME_COUNT_MISMATCH';

export interface PlannedTime {
  /** HH:mm, or null when it is ambiguous (see `alternatives`) or not a valid time. */
  value: string | null;
  /** "a las 6" -> ['18:00', '06:00'], the usual reading first. Empty when the time is not ambiguous. */
  alternatives: string[];
  certainty: 'EXACT' | 'LIKELY' | 'AMBIGUOUS';
  /** As written. */
  text: string;
  /** Which time item of the text it is: the days that share it share this number. */
  item: number;
  /** Overrides the group key (a time that came from a later reference clause is shared across mentions). */
  key?: string;
}

/** How the time reached its day: written next to it, by position ("los dos primeros"), or "respectivamente". */
export type TimeVia = 'DIRECT' | 'POSITIONAL' | 'RESPECTIVELY';

export interface PlannedDay {
  expr: DateExpression;
  text: string;
  /** "martes 13 de octubre": the weekday written next to an explicit date (only qualifies it). */
  weekdayHint?: Weekday;
  time: PlannedTime | null;
  timeIssue: TimeIssue | null;
  /** How `time` was assigned (provenance). */
  timeVia?: TimeVia;
  /** This day, or its time, was added by a later clause ("el parcial es a las 7"), not by the words around it. */
  fromReference?: { date?: boolean; time?: boolean };
  /** Two readings that disagree about this day's time (a later clause said another): the student chooses. */
  timeConflict?: PlannedTime[];
  /** The text of an invalid time that belongs to this day (to say it in the message). */
  invalidTimeText?: string;
  fromRange: boolean;
}

export interface Recurrence {
  /** "todos los martes", "cada martes", "semanal": it repeats. */
  strong: boolean;
  /** "los martes": a plural article before a weekday. Weaker: only worth asking about. */
  plural: boolean;
  /** "este semestre", "todo el semestre", "hasta fin de periodo": the end of the repetition is the period's. */
  untilPeriod: boolean;
  evidence: string[];
}

export interface TemporalPlan {
  days: PlannedDay[];
  /** How many time expressions the text had (a shared time may exist with no days). */
  timeItems: number;
  /** Each time expression, in order (null: written but not a valid time). */
  times: (PlannedTime | null)[];
  recurrence: Recurrence;
}

// ───────────────────────── Small dictionaries ─────────────────────────

const COUNT_WORDS: Readonly<Record<string, number>> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
};
const countOf = (norm: string | undefined): number | null =>
  norm === undefined ? null : (COUNT_WORDS[norm] ?? (/^[1-7]$/.test(norm) ? Number(norm) : null));

const ARTICLES = new Set(['el', 'los', 'la', 'las', 'este', 'esta', 'estos', 'estas']);
const DAY_WORDS = new Set(['dia', 'dias']);
const RANGE_WORDS = new Set(['a', 'al', 'hasta']);
const RESPECTIVELY = new Set([
  'respectivamente',
  'respectivo',
  'respectivos',
  'respectiva',
  'respectivas',
]);

// ───────────────────────── Positional phrases ─────────────────────────

interface Quantifier {
  kind: 'FIRST' | 'LAST' | 'REMAINING';
  /** null: not said ("los otros", "el resto"). */
  count: number | null;
  start: number;
  length: number;
}

/**
 * "los dos primeros (días)", "los primeros dos", "el primer día", "los dos últimos", "los otros dos (días)", "los
 * demás", "el resto". It only counts as one when it is followed by where a time starts ("a las…", a time), so a
 * title like "primer parcial" is never taken for it.
 */
function matchQuantifierAt(
  tokens: Token[],
  i: number,
  timeStarts: ReadonlySet<number>,
): Quantifier | null {
  const at = (k: number) => (isFree(tokens[i + k]) ? tokens[i + k]!.norm : undefined);
  let k = 0;
  if (at(0) !== undefined && ARTICLES.has(at(0)!)) k = 1;
  const word = at(k);
  let kind: Quantifier['kind'] | null = null;
  let count: number | null = null;
  let length = 0;

  if (
    word !== undefined &&
    countOf(word) !== null &&
    (at(k + 1) === 'primeros' || at(k + 1) === 'primeras')
  ) {
    kind = 'FIRST';
    count = countOf(word);
    length = k + 2;
  } else if (
    word !== undefined &&
    countOf(word) !== null &&
    (at(k + 1) === 'ultimos' || at(k + 1) === 'ultimas')
  ) {
    kind = 'LAST';
    count = countOf(word);
    length = k + 2;
  } else if (word === 'primeros' || word === 'primeras') {
    kind = 'FIRST';
    count = countOf(at(k + 1));
    length = k + (count === null ? 1 : 2);
  } else if (word === 'ultimos' || word === 'ultimas') {
    kind = 'LAST';
    count = countOf(at(k + 1));
    length = k + (count === null ? 1 : 2);
  } else if (word === 'primer' || word === 'primero' || word === 'primera') {
    kind = 'FIRST';
    count = 1;
    length = k + 1;
  } else if (word === 'ultimo' || word === 'ultima') {
    kind = 'LAST';
    count = 1;
    length = k + 1;
  } else if (word === 'otros' || word === 'otras' || word === 'demas' || word === 'restantes') {
    kind = 'REMAINING';
    count = countOf(at(k + 1));
    length = k + (count === null ? 1 : 2);
  } else if (word === 'resto') {
    kind = 'REMAINING';
    length = k + 1;
    if (at(length) === 'de') {
      let j = length + 1;
      if (at(j) !== undefined && ARTICLES.has(at(j)!)) j++;
      if (at(j) !== undefined && DAY_WORDS.has(at(j)!)) length = j + 1;
    }
  }
  if (kind === null) return null;
  if (at(length) !== undefined && DAY_WORDS.has(at(length)!)) length++;
  // It must be followed by where a time begins: "a las…" / "a la…" or the time itself.
  // (the time was already read and marked: `timeStarts` says where each one begins, connector included)
  if (!timeStarts.has(i + length)) return null;
  return { kind, count, start: i, length };
}

// ───────────────────────── Am/pm said in words ─────────────────────────

/**
 * "de la mañana" / "de la tarde" / "de la noche" / "de la madrugada" right after a time with no am/pm. It only decides
 * when the words leave no doubt for THAT hour ("7:30 de la noche" is 19:30; "1 de la noche" or "12 de la mañana" are
 * not clear, so they stay a question). Returns the time and how many tokens the phrase used.
 */
function meridiemWords(
  tokens: readonly Token[],
  at: number,
  alternatives: readonly string[],
): { value: string | null; length: number } | null {
  const [am, pm] = alternatives as [string, string];
  const hour = Number(am.slice(0, 2));
  if (tokens[at]?.used || tokens[at + 1]?.used || tokens[at + 2]?.used) return null;
  if (tokens[at]?.norm !== 'de' || tokens[at + 1]?.norm !== 'la') return null;
  const part = tokens[at + 2]?.norm;
  if (!['manana', 'madrugada', 'tarde', 'noche'].includes(part ?? '')) return null;
  const twelve = hour === 0 || hour === 12;
  // am[0..1] is "00" for 12:xx, so the readings of 12 are [00:mm, 12:mm].
  if (part === 'manana' && !twelve) return { value: am, length: 3 };
  if (part === 'madrugada' && !twelve && hour <= 6) return { value: am, length: 3 };
  if (part === 'tarde' && (twelve || (hour >= 1 && hour <= 8))) return { value: pm, length: 3 };
  if (part === 'noche' && twelve) return { value: am, length: 3 }; // 12 de la noche = 00:mm
  if (part === 'noche' && hour >= 6 && hour <= 11) return { value: pm, length: 3 };
  // The phrase is there but does not settle it ("1 de la noche", "12 de la mañana"): the time stays a question, and
  // "mañana" in it is not the word for tomorrow.
  return { value: null, length: 3 };
}

// ───────────────────────── The plan ─────────────────────────

interface TimeItem {
  pos: number;
  time: PlannedTime | null;
  invalidText?: string;
}

type Event =
  | { pos: number; type: 'DAY'; index: number }
  | { pos: number; type: 'TIME'; item: number }
  | { pos: number; type: 'QUANT'; quant: Quantifier }
  | { pos: number; type: 'RESP' };

/** The weekdays from `from` to `to` going forward, wrapping the week: "lunes a viernes" -> 1..5, "viernes a lunes" -> 5,6,7,1. */
function weekdaysBetween(from: Weekday, to: Weekday): Weekday[] {
  const out: Weekday[] = [from];
  let current = from;
  while (current !== to && out.length < 7) {
    current = (current === 7 ? 1 : current + 1) as Weekday;
    out.push(current);
  }
  return out;
}

/**
 * Plans the days and times of the tokens, and marks the tokens it used (times, days, their connectors, the positional
 * words) so what is left is the activity's own words. Deterministic and pure apart from marking `used`.
 */
export function planTemporal(tokens: Token[]): TemporalPlan {
  // 1. Times, with their connector ("a las 10am"). An hour with no am/pm is ambiguous, never 06:00.
  const timeItems: TimeItem[] = [];
  const timeStarts = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const match = matchTimeAt(tokens, i, { ambiguousBareHours: true });
    if (!match) continue;
    let start = match.start;
    let length = match.length;
    if (isFree(tokens[start - 1]) && ['las', 'la'].includes(tokens[start - 1]!.norm)) {
      start -= 1;
      length += 1;
      if (isFree(tokens[start - 1]) && tokens[start - 1]!.norm === 'a') {
        start -= 1;
        length += 1;
      }
    }
    const item = timeItems.length;
    timeStarts.add(start);
    if (match.alternatives) {
      // "7:30 de la mañana", "8 de la noche": the words say which one it is, so there is nothing to ask.
      const resolved = meridiemWords(tokens, match.start + match.length, match.alternatives);
      if (resolved) use(tokens, match.start + match.length, resolved.length);
      if (resolved && resolved.value !== null) {
        timeItems.push({
          pos: start,
          time: {
            value: resolved.value,
            alternatives: [],
            certainty: 'EXACT',
            text: match.text,
            item,
          },
        });
        use(tokens, start, length);
        i = match.start + match.length + resolved.length - 1;
        continue;
      }
      timeItems.push({
        pos: start,
        time: {
          value: null,
          alternatives: match.alternatives,
          certainty: 'AMBIGUOUS',
          text: match.text,
          item,
        },
      });
    } else if (match.value === null) {
      timeItems.push({ pos: start, time: null, invalidText: match.text });
    } else {
      timeItems.push({
        pos: start,
        time: {
          value: match.value,
          alternatives: [],
          certainty: match.likely ? 'LIKELY' : 'EXACT',
          text: match.text,
          item,
        },
      });
    }
    use(tokens, start, length);
    i = match.start + match.length - 1;

    // "a las 8 y 10 ...": hours with no am/pm continue the list the same way ("y"/"e" and a bare number).
    let bareList = match.alternatives !== undefined;
    while (bareList) {
      const joiner = tokens[i + 1];
      const number = tokens[i + 2];
      if (!isFree(joiner) || !['y', 'e'].includes(joiner.norm) || !isFree(number)) break;
      const bare = /^(\d{1,2})$/.exec(number.norm);
      if (!bare) break;
      const following = tokens[i + 3]?.norm ?? '';
      if (following === 'de' || WEEKDAY_BY_NAME[following] !== undefined) break; // the start of a date, not an hour
      const hour = Number(bare[1]);
      const next = timeItems.length;
      timeStarts.add(i + 1);
      if (hour >= 1 && hour <= 12) {
        timeItems.push({
          pos: i + 1,
          time: {
            value: null,
            alternatives: bareTimeAlternatives(hour),
            certainty: 'AMBIGUOUS',
            text: number.raw,
            item: next,
          },
        });
      } else {
        bareList = false;
        timeItems.push(
          hour >= 13 && hour <= 23
            ? {
                pos: i + 1,
                time: {
                  value: `${String(hour).padStart(2, '0')}:00`,
                  alternatives: [],
                  certainty: 'EXACT',
                  text: number.raw,
                  item: next,
                },
              }
            : { pos: i + 1, time: null, invalidText: number.raw },
        );
      }
      use(tokens, i + 1, 2);
      i += 2;
    }
  }

  // 2. Days: every date expression, ranges expanded ("lunes a viernes").
  const found = findDateExpressions(tokens);
  const days: PlannedDay[] = [];
  const dayStarts: number[] = [];
  const noiseBefore: { start: number; range: boolean }[] = [];
  for (let n = 0; n < found.length; n++) {
    const a = found[n]!;
    const b = found[n + 1];
    const isRange =
      b !== undefined &&
      a.match.expr.kind === 'weekday' &&
      b.match.expr.kind === 'weekday' &&
      b.match.start === a.match.start + a.match.length + 1 &&
      isFree(tokens[a.match.start + a.match.length]) &&
      RANGE_WORDS.has(tokens[a.match.start + a.match.length]!.norm);
    if (isRange) {
      const [from, to] = [a.match.expr, b.match.expr] as [
        Extract<DateExpression, { kind: 'weekday' }>,
        Extract<DateExpression, { kind: 'weekday' }>,
      ];
      for (const weekday of weekdaysBetween(from.weekday, to.weekday)) {
        days.push({
          expr: { kind: 'weekday', weekday, strictlyAfter: false },
          text: `${a.text} a ${b.text}`,
          time: null,
          timeIssue: null,
          fromRange: true,
        });
        dayStarts.push(a.match.start);
      }
      use(tokens, a.match.start + a.match.length, 1); // the "a" of the range
      use(tokens, a.match.start, a.match.length);
      use(tokens, b.match.start, b.match.length);
      noiseBefore.push({ start: a.match.start, range: true });
      n += 1;
      continue;
    }
    days.push({
      expr: a.match.expr,
      text: a.text,
      ...(a.weekdayHint !== undefined && { weekdayHint: a.weekdayHint }),
      time: null,
      timeIssue: null,
      fromRange: false,
    });
    dayStarts.push(a.match.start);
    use(tokens, a.match.start, a.match.length);
    noiseBefore.push({ start: a.match.start, range: false });
  }

  // The same day said twice ("martes y martes") is one day.
  const seen = new Set<string>();
  for (let n = days.length - 1; n >= 0; n--) {
    const d = days[n]!;
    const key = JSON.stringify(d.expr);
    if (seen.has(key) && !d.fromRange) {
      days.splice(n, 1);
      dayStarts.splice(n, 1);
    } else seen.add(key);
  }

  // 3. The words that only introduce a day ("el día lunes", "los martes", "de lunes a viernes") leave the title.
  let pluralArticle = false;
  for (const { start, range } of noiseBefore) {
    let p = start - 1;
    if (isFree(tokens[p]) && DAY_WORDS.has(tokens[p]!.norm)) {
      use(tokens, p, 1);
      p -= 1;
    }
    if (isFree(tokens[p]) && ARTICLES.has(tokens[p]!.norm)) {
      if (tokens[p]!.norm === 'los' || tokens[p]!.norm === 'las') {
        pluralArticle ||= WEEKDAY_BY_NAME[tokens[start]?.norm ?? ''] !== undefined;
      }
      use(tokens, p, 1);
      p -= 1;
    }
    if (range && isFree(tokens[p]) && tokens[p]!.norm === 'de') use(tokens, p, 1); // "de lunes a viernes"
  }

  // 4. Recurrence words.
  const recurrence: Recurrence = {
    strong: false,
    plural: pluralArticle,
    untilPeriod: false,
    evidence: [],
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.used) continue;
    if ((t.norm === 'todos' || t.norm === 'todas') && days.length > 0) {
      // (the article may already be marked: it was the noise before the weekday)
      const length = tokens[i + 1] && ARTICLES.has(tokens[i + 1]!.norm) ? 2 : 1;
      recurrence.strong = true;
      recurrence.evidence.push(
        tokens
          .slice(i, i + length)
          .map((x) => x.raw)
          .join(' '),
      );
      use(tokens, i, length);
    } else if (t.norm === 'cada' && days.length > 0) {
      recurrence.strong = true;
      recurrence.evidence.push(t.raw);
      use(tokens, i, 1);
    } else if (['semanal', 'semanales', 'semanalmente'].includes(t.norm)) {
      recurrence.strong = true;
      recurrence.evidence.push(t.raw);
      use(tokens, i, 1);
    }
  }
  if (recurrence.strong) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.used || !['semestre', 'periodo'].includes(tokens[i]!.norm)) continue;
      let from = i;
      const lead = new Set([
        'este',
        'esta',
        'el',
        'todo',
        'toda',
        'del',
        'fin',
        'de',
        'hasta',
        'lo',
        'que',
        'resta',
        'queda',
        'restante',
      ]);
      while (
        from > 0 &&
        from > i - 3 &&
        isFree(tokens[from - 1]) &&
        lead.has(tokens[from - 1]!.norm)
      )
        from--;
      recurrence.untilPeriod = true;
      recurrence.evidence.push(
        tokens
          .slice(from, i + 1)
          .map((x) => x.raw)
          .join(' '),
      );
      use(tokens, from, i - from + 1);
    }
  }

  // 5. Positional phrases ("los dos primeros", "los otros dos") and "respectivamente".
  const quants: Quantifier[] = [];
  let respectively = false;
  if (days.length >= 2) {
    for (let i = 0; i < tokens.length; i++) {
      const q = matchQuantifierAt(tokens, i, timeStarts);
      if (q) {
        quants.push(q);
        use(tokens, q.start, q.length);
        i = q.start + q.length - 1;
      }
    }
  }
  tokens.forEach((t, i) => {
    if (!t.used && RESPECTIVELY.has(t.norm)) {
      respectively = true;
      use(tokens, i, 1);
    }
  });

  // 6. Which time belongs to which day.
  const events: Event[] = [
    ...days.map((_, index) => ({ pos: dayStarts[index]!, type: 'DAY' as const, index })),
    ...timeItems.map((t, item) => ({ pos: t.pos, type: 'TIME' as const, item })),
    ...quants.map((quant) => ({ pos: quant.start, type: 'QUANT' as const, quant })),
  ].sort((a, b) => a.pos - b.pos);
  assignTimes(days, timeItems, events, quants.length > 0, respectively);

  return { days, timeItems: timeItems.length, times: timeItems.map((t) => t.time), recurrence };
}

function assignTimes(
  days: PlannedDay[],
  items: TimeItem[],
  events: Event[],
  positional: boolean,
  respectively: boolean,
): void {
  if (days.length === 0 || items.length === 0) return;
  const give = (index: number, item: TimeItem, via: TimeVia = 'DIRECT') => {
    const day = days[index]!;
    day.time = item.time;
    day.timeVia = via;
    if (item.time === null) {
      day.timeIssue = 'TIME_INVALID';
      if (item.invalidText) day.invalidTimeText = item.invalidText;
    }
  };
  const mark = (index: number, issue: TimeIssue) => {
    days[index]!.time = null;
    days[index]!.timeIssue = issue;
  };

  // By position: each time takes the phrase written right before it.
  if (positional) {
    const free = days.map((_, i) => i);
    let pending: Quantifier | null = null;
    for (const e of events) {
      if (e.type === 'QUANT') pending = e.quant;
      if (e.type !== 'TIME') continue;
      const item = items[e.item]!;
      const quant = pending;
      pending = null;
      if (quant === null) {
        // A time with no phrase among phrases: not guessable.
        for (const i of free.splice(0)) mark(i, 'TIME_UNASSIGNED');
        continue;
      }
      const need = quant.count ?? (quant.kind === 'REMAINING' ? free.length : 1);
      const enough = need <= free.length && (quant.kind !== 'REMAINING' || need === free.length);
      if (!enough) {
        for (const i of free.splice(0)) mark(i, 'TIME_COUNT_MISMATCH');
        continue;
      }
      const take =
        quant.kind === 'FIRST'
          ? free.splice(0, need)
          : quant.kind === 'LAST'
            ? free.splice(free.length - need, need)
            : free.splice(0);
      for (const i of take) give(i, item, 'POSITIONAL');
    }
    for (const i of free) mark(i, 'TIME_UNASSIGNED'); // days no phrase reached
    return;
  }

  // "a las 8 y 10 respectivamente": the times in the order of the days, only when they match one to one.
  if (respectively) {
    if (items.length === days.length) {
      items.forEach((item, i) => give(i, item, 'RESPECTIVELY'));
    } else {
      days.forEach((_, i) => mark(i, 'TIME_COUNT_MISMATCH'));
    }
    return;
  }

  // Runs: a time belongs to the days written since the previous time ("lunes y martes a las 7, jueves a las 4").
  let run: number[] = [];
  let runHasTime = false;
  let carried: TimeItem | null = null; // a time written BEFORE any day ("a las 8 lunes y martes")
  let lastWasTime = false;
  for (const e of events) {
    if (e.type === 'DAY') {
      if (lastWasTime) {
        run = [];
        runHasTime = false;
      }
      run.push(e.index);
      if (carried) give(e.index, carried);
      lastWasTime = false;
    } else if (e.type === 'TIME') {
      const item = items[e.item]!;
      if (run.length === 0) carried = item;
      else if (runHasTime)
        for (const i of run) mark(i, 'TIME_COUNT_MISMATCH'); // two times for the same days
      else {
        for (const i of run) give(i, item);
        runHasTime = true;
      }
      lastWasTime = true;
    }
  }
}
