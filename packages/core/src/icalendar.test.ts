import { describe, expect, it } from 'vitest';
import { dueFromLocal, DEFAULT_TIMEZONE } from './time.js';
import {
  activityEventUid,
  activityToIcs,
  escapeText,
  foldLine,
  normalizeText,
  type CalendarActivity,
  type CalendarSubject,
} from './icalendar.js';

const BOGOTA = DEFAULT_TIMEZONE;
const ID = '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70';

function activity(over: Partial<CalendarActivity> & { date?: string; time?: string } = {}) {
  const { date = '2026-10-23', time, ...rest } = over;
  const due = dueFromLocal({ date, time }, BOGOTA);
  return {
    id: ID,
    title: 'Taller de Bioestadística',
    dueAt: due.dueAt.toISOString(),
    hasTime: due.hasTime,
    updatedAt: '2026-10-07T12:00:00.000Z',
    ...rest,
  } satisfies CalendarActivity;
}

const SUBJECT: CalendarSubject = { name: 'Bioestadística', updatedAt: '2026-10-01T08:00:00.000Z' };
const ics = (a: CalendarActivity, subject: CalendarSubject | null = SUBJECT, timeZone = BOGOTA) =>
  activityToIcs({ activity: a, subject, timeZone });

/** The logical content lines: what a calendar app sees once the folds are undone. */
const logical = (text: string) => text.replaceAll('\r\n ', '').split('\r\n').slice(0, -1);
const prop = (text: string, name: string) =>
  logical(text)
    .find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))
    ?.slice(name.length);
/** Inverse of escapeText for a SUMMARY value, to prove the title survives. */
const unescapeText = (v: string) =>
  v.replaceAll(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
const summaryOf = (text: string) => unescapeText(prop(text, 'SUMMARY')!.slice(1));
/** UTF-8 size, counted independently of the serializer: every %XX of the percent-encoding is one octet. */
const octets = (s: string) => encodeURIComponent(s).replaceAll(/%[0-9A-F]{2}/g, 'x').length;

describe('a timed activity', () => {
  it('is a 15-minute block that ENDS at dueAt, in UTC', () => {
    const out = ics(activity({ time: '08:30' })); // 08:30 Bogotá = 13:30Z
    expect(prop(out, 'DTSTART')).toBe(':20261023T131500Z');
    expect(prop(out, 'DTEND')).toBe(':20261023T133000Z');
  });

  it('23:59 Bogotá stays on the right day (it is already the next day in UTC)', () => {
    const out = ics(activity({ time: '23:59' }));
    expect(prop(out, 'DTSTART')).toBe(':20261024T044400Z');
    expect(prop(out, 'DTEND')).toBe(':20261024T045900Z');
  });

  it('00:05 local: the block starts on the previous UTC (and local) day without breaking', () => {
    const out = ics(activity({ time: '00:05' }));
    expect(prop(out, 'DTSTART')).toBe(':20261023T045000Z');
    expect(prop(out, 'DTEND')).toBe(':20261023T050500Z');
  });
});

describe('an activity without a time', () => {
  it('is an all-day event on the local day, DTEND the next day (exclusive), with no 23:59', () => {
    const out = ics(activity());
    expect(prop(out, 'DTSTART')).toBe(';VALUE=DATE:20261023');
    expect(prop(out, 'DTEND')).toBe(';VALUE=DATE:20261024');
    expect(out).not.toContain('T235959');
    expect(out).not.toMatch(/DT(START|END):/);
  });

  it('takes the day from the user timezone, not from UTC (23:59 Bogotá is already the next day in UTC)', () => {
    const a = activity({ date: '2026-10-23' });
    expect(a.dueAt).toBe('2026-10-24T04:59:59.999Z');
    expect(prop(ics(a), 'DTSTART')).toBe(';VALUE=DATE:20261023');
  });

  it('follows another timezone: the same stored day in Asia/Tokyo', () => {
    const due = dueFromLocal({ date: '2026-10-23' }, 'Asia/Tokyo');
    const a = { ...activity(), dueAt: due.dueAt.toISOString() };
    expect(prop(ics(a, SUBJECT, 'Asia/Tokyo'), 'DTSTART')).toBe(';VALUE=DATE:20261023');
  });

  it('crosses a month and a year end', () => {
    expect(prop(ics(activity({ date: '2026-12-31' })), 'DTEND')).toBe(';VALUE=DATE:20270101');
    expect(prop(ics(activity({ date: '2028-02-28' })), 'DTEND')).toBe(';VALUE=DATE:20280229');
  });
});

describe('the subset that is written (and what is not)', () => {
  const out = ics(activity({ time: '08:30' }));

  it('is a complete VCALENDAR with one VEVENT, CRLF everywhere', () => {
    expect(logical(out)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Academic Planner//Add to calendar//ES',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:activity-${ID}`,
      'DTSTAMP:20261007T120000Z',
      'LAST-MODIFIED:20261007T120000Z',
      'DTSTART:20261023T131500Z',
      'DTEND:20261023T133000Z',
      'SUMMARY:Taller de Bioestadística — Bioestadística',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it.each([
    'METHOD',
    'VALARM',
    'SEQUENCE',
    'REFRESH-INTERVAL',
    'X-PUBLISHED-TTL',
    'RRULE',
    'VTIMEZONE',
  ])('has no %s', (name) => {
    expect(out).not.toContain(name);
  });

  it('writes nothing else about the activity or the user (no description, priority, status, e-mail…)', () => {
    // The real Activity has more fields than the serializer asks for: none of them may reach the file.
    const full = {
      ...activity({ time: '08:30' }),
      description: 'texto privado',
      priority: 'HIGH',
      status: 'COMPLETED',
      subjectId: 'abc',
    };
    const noisy = ics(full);
    for (const secret of ['texto privado', 'HIGH', 'COMPLETED', 'abc', 'ATTENDEE', 'ORGANIZER']) {
      expect(noisy, secret).not.toContain(secret);
    }
  });

  it('every physical line is at most 75 octets', () => {
    for (const title of [
      'x'.repeat(150),
      '日本語のテスト'.repeat(20),
      '😀'.repeat(37),
      'é'.repeat(80),
    ]) {
      for (const line of ics(activity({ title })).split('\r\n')) {
        expect(octets(line), line).toBeLessThanOrEqual(75);
      }
    }
  });
});

describe('determinism and identity', () => {
  it('the same activity exports the same bytes, every time', () => {
    const a = activity({ time: '08:30' });
    expect(ics(a)).toBe(ics({ ...a }));
  });

  it('the UID is opaque and stable: derived from the id only, no domain, e-mail or subject', () => {
    expect(activityEventUid(ID)).toBe(`activity-${ID}`);
    const uid = prop(ics(activity()), 'UID')!;
    expect(uid).toBe(`:activity-${ID}`);
    expect(uid).not.toMatch(/[@.]/);
    // editing the title, the date or the subject does not change who the event is
    expect(prop(ics(activity({ title: 'Otro', date: '2026-11-02' })), 'UID')).toBe(uid);
    expect(prop(ics(activity(), { name: 'Otra', updatedAt: SUBJECT.updatedAt }), 'UID')).toBe(uid);
  });

  it('DTSTAMP and LAST-MODIFIED follow the data (activity or subject), never the clock', () => {
    const base = ics(activity());
    expect(prop(base, 'DTSTAMP')).toBe(':20261007T120000Z');
    expect(prop(base, 'LAST-MODIFIED')).toBe(':20261007T120000Z');

    const edited = ics(activity({ updatedAt: '2026-10-08T09:30:15.789Z' }));
    expect(prop(edited, 'DTSTAMP')).toBe(':20261008T093015Z'); // milliseconds are dropped
    expect(prop(edited, 'LAST-MODIFIED')).toBe(':20261008T093015Z');

    const renamedSubject = ics(activity(), {
      name: 'Nueva',
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(prop(renamedSubject, 'DTSTAMP')).toBe(':20261101T000000Z'); // the subject name is in the title
  });

  it('works without a subject (title only)', () => {
    expect(summaryOf(ics(activity(), null))).toBe('Taller de Bioestadística');
  });
});

/** Synthetic hostile titles: each must read back exactly and must never inject anything. */
const TITLES: [string, string][] = [
  ['specials', 'a, b; c \\ d'],
  ['escape-lookalikes', 'barra-n literal: \\n y \\, y \\;'],
  ['colon-quotes', 'Hora: 10:30 "entrega" y \'ok\''],
  ['lf', 'línea uno\nlínea dos'],
  ['cr', 'a\rb'],
  ['crlf', 'a\r\nb'],
  ['accents', 'Evaluación ¿Qué tal? Pérez, Núñez; ñ á é í ó ú ü'],
  ['emoji-boundary', `${'x'.repeat(100)}😀😀😀 fin`],
  ['combining', `${'x'.repeat(100)}${'é'.repeat(12)} fin`],
  ['cjk', '日本語のテスト'.repeat(10)],
  ['rtl', 'Reunión שלום עולם 12:30'],
  ['spaces', 'Palabra '.repeat(40).trimEnd()],
];

describe('the title is untrusted text', () => {
  it.each(TITLES)('%s survives exactly', (_name, title) => {
    const out = ics(activity({ title }), null);
    expect(summaryOf(out)).toBe(normalizeText(title));
    for (const line of out.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);
    // the only CR and LF in the file are the CRLF that end the lines
    expect(out.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('every kind of line break in a title becomes the two characters \\n, never a raw CR or LF', () => {
    for (const title of ['a\nb', 'a\rb', 'a\r\nb']) {
      expect(prop(ics(activity({ title }), null), 'SUMMARY')).toBe(':a\\nb');
    }
  });

  it('a CRLF in the title cannot start a component or a property', () => {
    const hostile = [
      'Parcial\r\nBEGIN:VEVENT\r\nUID:injected\r\nSUMMARY:pwned\r\nEND:VEVENT',
      'Parcial\r\nATTENDEE;CN=Atacante:mailto:atacante@example.test\r\nDESCRIPTION:falso',
      'Parcial\nORGANIZER:mailto:x@example.test',
      'Parcial\rMETHOD:PUBLISH',
    ];
    for (const title of hostile) {
      const lines = logical(ics(activity({ title }), SUBJECT));
      const names = lines.map((l) => l.split(/[:;]/)[0]);
      expect(names.filter((n) => n === 'BEGIN')).toEqual(['BEGIN', 'BEGIN']); // VCALENDAR + the one VEVENT
      expect(names).not.toContain('ATTENDEE');
      expect(names).not.toContain('ORGANIZER');
      expect(names).not.toContain('DESCRIPTION');
      expect(names).not.toContain('METHOD');
      expect(lines.filter((l) => l.startsWith('UID:'))).toEqual([`UID:activity-${ID}`]);
    }
  });

  it('control characters are dropped and a lone surrogate becomes U+FFFD', () => {
    expect(normalizeText('a\u0000b\u0007c\u001bd\u007fe')).toBe('abcde');
    expect(normalizeText('a\tb')).toBe('a\tb');
    expect(normalizeText(`a${String.fromCharCode(0xd83d)}b`)).toBe('a�b');
    expect(summaryOf(ics(activity({ title: 'a\u0000b' }), null))).toBe('ab');
  });

  it('an empty title (only control characters) falls back to a neutral word', () => {
    expect(summaryOf(ics(activity({ title: '\u0000\u0001' }), null))).toBe('Actividad');
  });

  it('escapeText escapes backslash, semicolon, comma and newline but not colon or quotes', () => {
    expect(escapeText('a\\b;c,d\ne:f"g')).toBe('a\\\\b\\;c\\,d\\ne:f"g');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone and folds a long one at exactly 75 octets', () => {
    expect(foldLine('short')).toBe('short');
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`).split('\r\n');
    expect(folded[0]).toHaveLength(75);
    expect(folded.slice(1, -1).every((l) => l.length === 75 && l.startsWith(' '))).toBe(true);
    expect(folded.join('').replaceAll(' ', '')).toBe(`SUMMARY:${'x'.repeat(200)}`);
  });

  it('never splits a multi-octet character and never ends a physical line with a space', () => {
    for (let pad = 60; pad < 80; pad++) {
      const line = `SUMMARY:${'a'.repeat(pad)}😀é日 b c d e f g`;
      const folded = foldLine(line);
      expect(folded.replaceAll('\r\n ', '')).toBe(line);
      for (const physical of folded.split('\r\n')) {
        expect(octets(physical)).toBeLessThanOrEqual(75);
        expect(physical.endsWith(' ')).toBe(false);
      }
    }
  });
});
