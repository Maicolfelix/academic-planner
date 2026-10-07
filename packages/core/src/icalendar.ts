/**
 * "Añadir al calendario" (A4.1): ONE activity -> an iCalendar (RFC 5545) file the student's calendar app can open.
 * Pure functions: no clock, no I/O. The same input is always the same bytes.
 *
 * The subset is deliberately tiny and every choice is documented, with its RFC section, in
 * docs/spikes/a4-calendar-feed/normative-validation.md:
 *  - NO `METHOD` (RFC 5546 §3.2.1: PUBLISH would require an ORGANIZER), `VALARM`, `SEQUENCE`, `REFRESH-INTERVAL`,
 *    `X-PUBLISHED-TTL`, `RRULE` or `VTIMEZONE`: instants are written in UTC and a day without hour as a DATE.
 *  - `DTSTAMP` = `LAST-MODIFIED` = the last time the data of the event changed (RFC 5545 §3.8.7.2: without METHOD they
 *    are equivalent). Never the time of the export, so an unchanged activity exports identical bytes.
 *  - `UID` is opaque and stable (RFC 7986 §5.3): it contains no domain, e-mail or user data.
 *  - The title is untrusted text: it is normalised and escaped so it can never end its line and start another
 *    property or component (`escapeText`), and every line is folded at 75 OCTETS (`foldLine`).
 */
import { addDays } from './calendar.js';
import { toLocalParts } from './time.js';

/** A deadline with a time is drawn as a block this long that ENDS at `dueAt` (see docs/calendar-export.md). */
export const CALENDAR_BLOCK_MINUTES = 15;

export const CALENDAR_EXPORT_FILENAME = 'academic-planner-activity.ics';
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

const CRLF = '\r\n';
const MAX_OCTETS = 75;
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);

/**
 * The text the title reads back as once it is safe to write: every line break (CRLF, CR, LF) becomes ONE LF,
 * control characters (U+0000–0008, 000B, 000C, 000E–001F, 007F) are dropped (TAB stays) and a lone UTF-16
 * surrogate (which has no UTF-8 encoding) becomes U+FFFD.
 */
export function normalizeText(raw: string): string {
  let out = '';
  for (const ch of raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n')) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) out += REPLACEMENT_CHARACTER;
    else if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f))
      continue;
    else if (code === 0x7f) continue;
    else out += ch;
  }
  return out;
}

/** An untrusted string -> the value of a TEXT property (RFC 5545 §3.3.11): `\` `;` `,` and newlines escaped. */
export function escapeText(raw: string): string {
  return normalizeText(raw)
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

/** UTF-8 size of one code point. */
function octets(ch: string): number {
  const code = ch.codePointAt(0)!;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

/**
 * One content line -> physical lines of at most 75 OCTETS (RFC 5545 §3.1) joined by CRLF + space. It only splits
 * between code points (never inside a multi-octet UTF-8 sequence) and never leaves a physical line ending in a
 * space: a tool that trims trailing whitespace would otherwise corrupt the text.
 */
export function foldLine(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = octets(ch);
    const limit = chunks.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1; // a continuation line starts with one space
    if (bytes + size > limit) {
      const trailing = /[ ]+$/.exec(current)?.[0] ?? '';
      chunks.push(current.slice(0, current.length - trailing.length));
      current = trailing;
      bytes = trailing.length;
    }
    current += ch;
    bytes += size;
  }
  chunks.push(current);
  return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join(CRLF);
}

/** `2026-10-24T04:59:00.000Z` -> `20261024T045900Z` (seconds precision: iCalendar DATE-TIME has no milliseconds). */
function utcStamp(instant: Date): string {
  return `${new Date(Math.floor(instant.getTime() / 1000) * 1000)
    .toISOString()
    .slice(0, 19)
    .replaceAll(/[-:]/g, '')}Z`;
}

const dateValue = (day: string) => day.replaceAll('-', '');

export interface CalendarActivity {
  id: string;
  title: string;
  dueAt: string;
  hasTime: boolean;
  updatedAt: string;
}

export interface CalendarSubject {
  name: string;
  updatedAt: string;
}

/** The stable, opaque UID of an activity (an iana-token: letters, digits and hyphens). */
export const activityEventUid = (activityId: string): string => `activity-${activityId}`;

/**
 * The `.ics` of one activity.
 *  - without a time (`hasTime` false): an all-day event on the user's local day (`DTEND` is the next day, exclusive);
 *    the 23:59 the app stores is NOT written;
 *  - with a time: a block of CALENDAR_BLOCK_MINUTES that ends at `dueAt`, in UTC. It says "this is the instant I know",
 *    not that the exam lasts 15 minutes.
 * `SUMMARY` is "Title — Subject"; nothing else about the activity or the user is written.
 */
export function activityToIcs(input: {
  activity: CalendarActivity;
  subject: CalendarSubject | null;
  timeZone: string;
}): string {
  const { activity, subject, timeZone } = input;
  const dueAt = new Date(activity.dueAt);

  const stampMs = Math.max(
    new Date(activity.updatedAt).getTime(),
    subject ? new Date(subject.updatedAt).getTime() : 0,
  );
  const stamp = utcStamp(new Date(stampMs));

  let when: string[];
  if (activity.hasTime) {
    const start = new Date(dueAt.getTime() - CALENDAR_BLOCK_MINUTES * 60_000);
    when = [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(dueAt)}`];
  } else {
    const day = toLocalParts(dueAt, timeZone).date;
    when = [
      `DTSTART;VALUE=DATE:${dateValue(day)}`,
      `DTEND;VALUE=DATE:${dateValue(addDays(day, 1))}`,
    ];
  }

  const title = normalizeText(activity.title).trim() || 'Actividad';
  const summary = subject ? `${title} — ${normalizeText(subject.name).trim()}` : title;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Academic Planner//Add to calendar//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${activityEventUid(activity.id)}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    ...when,
    `SUMMARY:${escapeText(summary)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
