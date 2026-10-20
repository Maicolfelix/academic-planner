import {
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_MAX_EVENTS,
  ICS_IMPORT_MESSAGES,
  toLocalParts,
  zonedTimeToUtc,
  type IcsMoment,
  type IcsRawEvent,
  type IcsRule,
} from '@planner/core';
import ICAL from 'ical.js';

/**
 * The adapter between a .ics file and `IcsRawEvent`s (the vocabulary of the pure rules in `@planner/core`). The library reads the
 * format (line folding, escapes, parameters, RRULE, VTIMEZONE); this file only turns what it reads into the STUDENT's local
 * dates and times. The file is processed in memory and discarded: nothing of it is stored.
 *
 * Times: a date-only value stays that date (it is never turned into an instant, so no timezone can shift the day); UTC (`Z`) and
 * a TZID are converted to the student's timezone; a floating time (no zone) is read as the student's own wall clock. A TZID
 * that is neither defined by a VTIMEZONE in the file nor a valid IANA name is not guessed: the date is reported as invalid.
 */

export class IcsFileError extends Error {
  constructor(
    readonly code:
      'EMPTY' | 'TOO_LARGE' | 'NOT_CALENDAR' | 'TOO_MANY' | 'NO_EVENTS' | 'INVALID_TEXT',
  ) {
    super(ICS_IMPORT_MESSAGES[code]);
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const dateOf = (t: { year: number; month: number; day: number }) =>
  `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;

const isIana = (tzid: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
};

const WRITTEN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z?)?$/;
function isRealWritten(text: string): boolean {
  const m = WRITTEN.exec(text);
  if (!m) return false;
  const [y, mo, d, h = 0, mi = 0, se = 0] = m
    .slice(1)
    .map((x) => (x === undefined ? undefined : Number(x))) as number[];
  const t = new Date(Date.UTC(y!, mo! - 1, d!, h, mi, se));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo! - 1 &&
    t.getUTCDate() === d &&
    h <= 23 &&
    mi <= 59 &&
    se <= 60
  );
}

/** The student's local date/time of an iCalendar value, or null when it cannot be read honestly. */
function momentOf(prop: ICAL.Property | null, userTimeZone: string): IcsMoment | null {
  if (!prop) return null;
  let value: ICAL.Time;
  try {
    value = prop.getFirstValue() as ICAL.Time;
  } catch {
    return null;
  }
  if (!value || typeof value.year !== 'number' || Number.isNaN(value.year)) return null;
  // The library rolls an impossible date over (month 13 becomes next January): the value as WRITTEN must be a real date and time.
  if (!isRealWritten(String((prop.jCal as unknown[])[3]))) return null;
  if (value.year < 1970 || value.year > 2100) return null;
  if (value.isDate) return { allDay: true, date: dateOf(value) };

  const wall = {
    date: dateOf(value),
    hour: value.hour,
    minute: value.minute,
    second: value.second,
  };
  let instant: Date;
  if (value.zone === ICAL.Timezone.utcTimezone) {
    instant = new Date(
      Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second),
    );
  } else {
    const tzid = prop.getParameter('tzid') as string | undefined;
    if (!tzid) {
      // Floating: the student's own wall clock.
      return { allDay: false, date: wall.date, time: `${pad(value.hour)}:${pad(value.minute)}` };
    }
    if (ICAL.TimezoneService.has(tzid)) {
      const zone = ICAL.TimezoneService.get(tzid);
      const zoned = ICAL.Time.fromData(
        {
          year: value.year,
          month: value.month,
          day: value.day,
          hour: value.hour,
          minute: value.minute,
          second: value.second,
        },
        zone,
      );
      instant = new Date(zoned.toUnixTime() * 1000);
    } else if (isIana(tzid)) {
      instant = zonedTimeToUtc(wall, tzid);
    } else {
      return null;
    }
  }
  const local = toLocalParts(instant, userTimeZone);
  return { allDay: false, date: local.date, time: local.time };
}

function ruleOf(vevent: ICAL.Component, userTimeZone: string): IcsRule | 'INVALID' | null {
  const props = vevent.getAllProperties('rrule');
  if (props.length === 0) return null;
  if (props.length > 1) return 'INVALID';
  let recur: ICAL.Recur;
  try {
    recur = props[0]!.getFirstValue() as ICAL.Recur;
  } catch {
    return 'INVALID';
  }
  if (!recur || typeof recur.freq !== 'string') return 'INVALID';
  const parts = (recur.parts ?? {}) as Record<string, unknown[]>;
  const byday = ((parts.BYDAY as string[] | undefined) ?? []).map((d) => String(d).toUpperCase());
  const other = Object.keys(parts).some((k) => k !== 'BYDAY');
  let until: string | null = null;
  if (recur.until) {
    const u = recur.until;
    if (u.isDate) until = dateOf(u);
    else {
      const instant =
        u.zone === ICAL.Timezone.utcTimezone
          ? new Date(Date.UTC(u.year, u.month - 1, u.day, u.hour, u.minute, u.second))
          : null;
      until = instant ? toLocalParts(instant, userTimeZone).date : dateOf(u);
    }
  }
  return {
    freq: recur.freq.toUpperCase(),
    interval: Number.isInteger(recur.interval) ? recur.interval : 1,
    byday,
    until,
    count: typeof recur.count === 'number' ? recur.count : null,
    other,
  };
}

/** Control characters other than tab, CR and LF make the file binary or hostile: it is refused, not cleaned. */
function assertText(buffer: Buffer): string {
  for (const byte of buffer) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
      throw new IcsFileError('INVALID_TEXT');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    throw new IcsFileError('NOT_CALENDAR');
  }
}

export function parseIcsFile(buffer: Buffer, userTimeZone: string): IcsRawEvent[] {
  if (buffer.length === 0) throw new IcsFileError('EMPTY');
  if (buffer.length > ICS_IMPORT_MAX_BYTES) throw new IcsFileError('TOO_LARGE');
  const text = assertText(buffer);
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) throw new IcsFileError('NOT_CALENDAR');

  // The timezone registry of the library is process-wide: parsing is synchronous, so it is reset before and after.
  ICAL.TimezoneService.reset();
  try {
    let roots: unknown;
    try {
      roots = ICAL.parse(text);
    } catch {
      throw new IcsFileError('NOT_CALENDAR');
    }
    const jcals = (Array.isArray(roots) && Array.isArray(roots[0]) ? roots : [roots]) as unknown[];
    const events: IcsRawEvent[] = [];
    for (const jcal of jcals) {
      const calendar = new ICAL.Component(jcal as never);
      if (calendar.name !== 'vcalendar') throw new IcsFileError('NOT_CALENDAR');
      for (const tz of calendar.getAllSubcomponents('vtimezone')) {
        try {
          ICAL.TimezoneService.register(tz);
        } catch {
          /* an unreadable VTIMEZONE: its TZID will be reported as invalid when used */
        }
      }
      const vevents = calendar.getAllSubcomponents('vevent');
      if (events.length + vevents.length > ICS_IMPORT_MAX_EVENTS)
        throw new IcsFileError('TOO_MANY');
      for (const v of vevents) {
        const text = (name: string) => {
          const value = v.getFirstPropertyValue(name);
          return typeof value === 'string' ? value : null;
        };
        events.push({
          index: events.length + 1,
          uid: text('uid')?.trim() || null,
          summary: (text('summary') ?? '').replace(/\s*\n\s*/g, ' ').trim(),
          description: text('description')?.trim() || null,
          location: text('location')?.trim() || null,
          status: text('status'),
          hasRecurrenceId: v.hasProperty('recurrence-id'),
          hasRdate: v.hasProperty('rdate'),
          start: momentOf(v.getFirstProperty('dtstart'), userTimeZone),
          end: momentOf(v.getFirstProperty('dtend'), userTimeZone),
          rrule: ruleOf(v, userTimeZone),
          exdateCount: v.getAllProperties('exdate').reduce((n, p) => n + p.getValues().length, 0),
        });
      }
    }
    if (events.length === 0) throw new IcsFileError('NO_EVENTS');
    return events;
  } finally {
    ICAL.TimezoneService.reset();
  }
}
