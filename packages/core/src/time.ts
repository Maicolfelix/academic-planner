/**
 * Every timezone conversion in the product lives in this file. Components never convert by hand:
 * they call these functions. Instants are stored in UTC and shown in the user's timezone.
 * Pure functions: nothing here reads the clock; callers inject `now` when they need it.
 */

/** Initial target timezone. */
export const DEFAULT_TIMEZONE = 'America/Bogota';

export interface LocalParts {
  /** "YYYY-MM-DD" in the given timezone. */
  date: string;
  /** "HH:mm" (24h) in the given timezone. */
  time: string;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function zonedFields(utcMs: number, timeZone: string) {
  const p = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of `timeZone` from UTC at the instant `utcMs`, in ms (Bogotá: -18_000_000). */
function offsetMs(utcMs: number, timeZone: string): number {
  const f = zonedFields(utcMs, timeZone);
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Wall-clock time in `timeZone` -> the UTC instant. The second pass re-reads the offset at the first
 * result, which fixes wall times near a daylight-saving change (Bogotá has none, other zones do).
 */
export function zonedTimeToUtc(
  local: { date: string; hour: number; minute: number; second?: number; ms?: number },
  timeZone: string,
): Date {
  const [y, m, d] = local.date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, local.hour, local.minute, local.second ?? 0, local.ms ?? 0);
  const firstGuess = naive - offsetMs(naive, timeZone);
  return new Date(naive - offsetMs(firstGuess, timeZone));
}

/**
 * The user's input ("day" and an optional "HH:mm") -> what is stored.
 *  - with a time: that wall time in the user's timezone, hasTime = true
 *    (Bogotá 2026-10-10 14:00 -> 2026-10-10T19:00:00.000Z)
 *  - without: the END of that local day, 23:59:59.999, hasTime = false
 *    (Bogotá 2026-10-10 -> 2026-10-11T04:59:59.999Z)
 */
export function dueFromLocal(
  input: { date: string; time?: string | null },
  timeZone: string,
): { dueAt: Date; hasTime: boolean } {
  if (input.time) {
    const [hour, minute] = input.time.split(':').map(Number) as [number, number];
    return { dueAt: zonedTimeToUtc({ date: input.date, hour, minute }, timeZone), hasTime: true };
  }
  return {
    dueAt: zonedTimeToUtc(
      { date: input.date, hour: 23, minute: 59, second: 59, ms: 999 },
      timeZone,
    ),
    hasTime: false,
  };
}

/** Start (00:00:00.000) and end (23:59:59.999) of a local day, as UTC instants. */
export function localDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc({ date, hour: 0, minute: 0 }, timeZone),
    end: zonedTimeToUtc({ date, hour: 23, minute: 59, second: 59, ms: 999 }, timeZone),
  };
}

/** UTC instant -> the date and time on the user's wall clock (for pre-filling edit forms). */
export function toLocalParts(instant: Date | string, timeZone: string): LocalParts {
  const f = zonedFields(new Date(instant).getTime(), timeZone);
  return {
    date: `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}`,
    time: `${pad(f.hour)}:${pad(f.minute)}`,
  };
}

/** "10:00 a. m." on the user's wall clock (12-hour, Colombian Spanish). */
export function formatClock(instant: Date | string, timeZone: string, locale = 'es-CO'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(instant));
}

/**
 * Human text for a due date, in the user's timezone: "vie, 10 oct 2026" or, when the user chose a
 * time, "vie, 10 oct 2026, 2:00 p. m.". Without a time no hour is shown (the stored 23:59 is an
 * implementation detail, not something the student typed).
 */
export function formatDue(
  due: { dueAt: Date | string; hasTime: boolean },
  timeZone: string,
  locale = 'es-CO',
): string {
  const instant = new Date(due.dueAt);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
  if (!due.hasTime) return day;
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant);
  return `${day}, ${time}`;
}
