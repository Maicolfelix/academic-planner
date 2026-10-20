import { ICS_IMPORT_MAX_BYTES, ICS_IMPORT_MAX_EVENTS, proposeIcsEvents } from '@planner/core';
import { describe, expect, it } from 'vitest';
import { IcsFileError, parseIcsFile } from './parseIcs.js';

const BOGOTA = 'America/Bogota';
const cal = (...events: string[][]) =>
  Buffer.from(
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      ...events.flat(),
      'END:VCALENDAR',
    ].join('\r\n'),
    'utf8',
  );
const vevent = (...lines: string[]) => [
  'BEGIN:VEVENT',
  'UID:u-' + Math.random().toString(36).slice(2),
  ...lines,
  'END:VEVENT',
];
const parse = (buffer: Buffer, tz = BOGOTA) => parseIcsFile(buffer, tz);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof IcsFileError ? err.code : String(err);
  }
  return null;
};

describe('times', () => {
  it('TZID America/Bogota: the wall clock as written', () => {
    const [e] = parse(
      cal(
        vevent(
          'SUMMARY:Clase',
          'DTSTART;TZID=America/Bogota:20261020T070000',
          'DTEND;TZID=America/Bogota:20261020T090000',
        ),
      ),
    );
    expect(e!.start).toEqual({ allDay: false, date: '2026-10-20', time: '07:00' });
    expect(e!.end).toEqual({ allDay: false, date: '2026-10-20', time: '09:00' });
  });
  it('UTC is converted to the student’s timezone (15:00Z = 10:00 in Bogotá, the day before in Tokyo? no: 00:00 next day)', () => {
    const buf = cal(vevent('SUMMARY:Parcial', 'DTSTART:20261023T150000Z'));
    expect(parse(buf)[0]!.start).toEqual({ allDay: false, date: '2026-10-23', time: '10:00' });
    expect(parse(buf, 'Asia/Tokyo')[0]!.start).toEqual({
      allDay: false,
      date: '2026-10-24',
      time: '00:00',
    });
  });
  it('another TZID is converted to the student’s zone (New York 10:00 EDT = 09:00 in Bogotá)', () => {
    const [e] = parse(cal(vevent('SUMMARY:X', 'DTSTART;TZID=America/New_York:20261023T100000')));
    expect(e!.start).toEqual({ allDay: false, date: '2026-10-23', time: '09:00' });
  });
  it('floating time is the student’s own wall clock, in any timezone', () => {
    const buf = cal(vevent('SUMMARY:X', 'DTSTART:20261023T100000'));
    expect(parse(buf)[0]!.start).toEqual({ allDay: false, date: '2026-10-23', time: '10:00' });
    expect(parse(buf, 'Asia/Tokyo')[0]!.start).toEqual({
      allDay: false,
      date: '2026-10-23',
      time: '10:00',
    });
  });
  it('all-day keeps its date with no timezone shift, for any timezone', () => {
    const buf = cal(vevent('SUMMARY:Entrega', 'DTSTART;VALUE=DATE:20261030'));
    for (const tz of [BOGOTA, 'Asia/Tokyo', 'Pacific/Auckland']) {
      expect(parse(buf, tz)[0]!.start).toEqual({ allDay: true, date: '2026-10-30' });
    }
  });
  it('a TZID defined by a VTIMEZONE in the file (Outlook style) is honoured', () => {
    const vtimezone = [
      'BEGIN:VTIMEZONE',
      'TZID:SA Pacific Standard Time',
      'BEGIN:STANDARD',
      'DTSTART:16010101T000000',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
    const buf = cal(
      vtimezone,
      vevent('SUMMARY:X', 'DTSTART;TZID=SA Pacific Standard Time:20261023T100000'),
    );
    expect(parse(buf)[0]!.start).toEqual({ allDay: false, date: '2026-10-23', time: '10:00' });
  });
  it('an unknown TZID is not guessed: the date is reported as invalid', () => {
    expect(
      parse(cal(vevent('SUMMARY:X', 'DTSTART;TZID=Mars/Olympus:20261023T100000')))[0]!.start,
    ).toBeNull();
  });
  it('an invalid DTSTART is null; a missing one too', () => {
    expect(parse(cal(vevent('SUMMARY:X', 'DTSTART:20261340T100000')))[0]!.start).toBeNull();
    expect(parse(cal(vevent('SUMMARY:X')))[0]!.start).toBeNull();
  });
});

describe('text', () => {
  it('unfolds lines, unescapes \\n \\, \\; \\\\ and keeps UTF-8', () => {
    const buf = Buffer.from(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:1',
        'SUMMARY:Bioquímica\\, Programación e Inglés',
        'DESCRIPTION:Primera línea\\nSegunda; con \\; y \\\\ barra y un texto muy lar',
        ' go que continúa en otra línea',
        'LOCATION:Aula 3\\, Edificio B',
        'DTSTART:20261023T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
      'utf8',
    );
    const [e] = parse(buf);
    expect(e!.summary).toBe('Bioquímica, Programación e Inglés');
    expect(e!.description).toBe(
      'Primera línea\nSegunda; con ; y \\ barra y un texto muy largo que continúa en otra línea',
    );
    expect(e!.location).toBe('Aula 3, Edificio B');
  });
  it('accepts LF-only line endings and a BOM', () => {
    const buf = Buffer.from(
      '﻿BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:1\nSUMMARY:Ñandú\nDTSTART:20261023T100000\nEND:VEVENT\nEND:VCALENDAR\n',
      'utf8',
    );
    expect(parse(buf)[0]!.summary).toBe('Ñandú');
  });
});

describe('repetition and exceptions', () => {
  it('reads FREQ, BYDAY, COUNT, UNTIL (in local terms) and counts EXDATE', () => {
    const [a, b, c] = parse(
      cal(
        vevent(
          'SUMMARY:A',
          'DTSTART;TZID=America/Bogota:20261020T070000',
          'DTEND;TZID=America/Bogota:20261020T090000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4',
          'EXDATE;TZID=America/Bogota:20261027T070000,20261103T070000',
        ),
        vevent(
          'SUMMARY:B',
          'DTSTART;TZID=America/Bogota:20261020T070000',
          'RRULE:FREQ=WEEKLY;UNTIL=20261201T120000Z',
        ),
        vevent(
          'SUMMARY:C',
          'DTSTART;TZID=America/Bogota:20261020T070000',
          'RRULE:FREQ=MONTHLY;BYMONTHDAY=5',
        ),
      ),
    );
    expect(a!.rrule).toMatchObject({
      freq: 'WEEKLY',
      interval: 1,
      byday: ['TU', 'TH'],
      count: 4,
      until: null,
      other: false,
    });
    expect(a!.exdateCount).toBe(2);
    expect(b!.rrule).toMatchObject({ freq: 'WEEKLY', until: '2026-12-01' });
    expect(c!.rrule).toMatchObject({ freq: 'MONTHLY', other: true });
  });
  it('flags a modified instance (RECURRENCE-ID), RDATE and a cancelled status', () => {
    const [a, b, c] = parse(
      cal(
        vevent('SUMMARY:A', 'DTSTART:20261020T070000', 'RECURRENCE-ID:20261020T070000'),
        vevent('SUMMARY:B', 'DTSTART:20261020T070000', 'RDATE:20261021T070000'),
        vevent('SUMMARY:C', 'DTSTART:20261020T070000', 'STATUS:CANCELLED'),
      ),
    );
    expect([a!.hasRecurrenceId, b!.hasRdate, c!.status]).toEqual([true, true, 'CANCELLED']);
  });
});

describe('the file is refused, never cleaned', () => {
  it('empty, not a calendar, binary, NUL and invalid UTF-8', () => {
    expect(code(() => parse(Buffer.alloc(0)))).toBe('EMPTY');
    expect(code(() => parse(Buffer.from('hola mundo')))).toBe('NOT_CALENDAR');
    expect(code(() => parse(Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')))).toBe(
      'NO_EVENTS',
    );
    expect(
      code(() => parse(Buffer.from('BEGIN:VCALENDAR\r\nSUMMARY:a\u0000b\r\nEND:VCALENDAR\r\n'))),
    ).toBe('INVALID_TEXT');
    expect(
      code(() =>
        parse(
          Buffer.from([
            0x42, 0x45, 0x47, 0x49, 0x4e, 0x3a, 0x56, 0x43, 0x41, 0x4c, 0x45, 0x4e, 0x44, 0x41,
            0x52, 0x0d, 0x0a, 0xff, 0xfe,
          ]),
        ),
      ),
    ).toBe('NOT_CALENDAR');
  });
  it('more than the limit of events is refused', () => {
    const events = Array.from({ length: ICS_IMPORT_MAX_EVENTS + 1 }, (_, i) =>
      vevent(`SUMMARY:E${i}`, 'DTSTART:20261023T100000'),
    );
    expect(code(() => parse(cal(...events)))).toBe('TOO_MANY');
    const ok = Array.from({ length: ICS_IMPORT_MAX_EVENTS }, (_, i) =>
      vevent(`SUMMARY:E${i}`, 'DTSTART:20261023T100000'),
    );
    expect(parse(cal(...ok))).toHaveLength(ICS_IMPORT_MAX_EVENTS);
  });
  it('a file over the size limit is refused', () => {
    expect(code(() => parse(Buffer.alloc(ICS_IMPORT_MAX_BYTES + 1, 0x41)))).toBe('TOO_LARGE');
  });
  it('the registry of timezones does not leak between files', () => {
    const withZone = cal(
      [
        'BEGIN:VTIMEZONE',
        'TZID:Zona Mia',
        'BEGIN:STANDARD',
        'DTSTART:16010101T000000',
        'TZOFFSETFROM:+0300',
        'TZOFFSETTO:+0300',
        'END:STANDARD',
        'END:VTIMEZONE',
      ],
      vevent('SUMMARY:X', 'DTSTART;TZID=Zona Mia:20261023T100000'),
    );
    expect(parse(withZone)[0]!.start).toMatchObject({ time: '02:00' }); // 10:00 at +03:00 = 07:00Z = 02:00 in Bogotá
    expect(
      parse(cal(vevent('SUMMARY:X', 'DTSTART;TZID=Zona Mia:20261023T100000')))[0]!.start,
    ).toBeNull();
  });
});

describe('from file to proposals', () => {
  it('weekly class + single exam + all-day deadline', () => {
    const events = parse(
      cal(
        vevent(
          'SUMMARY:Clase Ciberseguridad',
          'DTSTART;TZID=America/Bogota:20261020T070000',
          'DTEND;TZID=America/Bogota:20261020T090000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
        vevent(
          'SUMMARY:Parcial Ciberseguridad',
          'DTSTART;TZID=America/Bogota:20261023T100000',
          'DTEND;TZID=America/Bogota:20261023T120000',
        ),
        vevent('SUMMARY:Entrega final', 'DTSTART;VALUE=DATE:20261030'),
      ),
    );
    const ctx = {
      subjects: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Ciberseguridad',
          periodId: '00000000-0000-4000-8000-000000000100',
        },
      ],
    };
    const { proposals, summary } = proposeIcsEvents(events, ctx);
    expect(proposals.map((p) => p.kindProposal)).toEqual([
      'SCHEDULE_BLOCK',
      'ACTIVITY',
      'ACTIVITY',
    ]);
    expect(proposals[2]).toMatchObject({ date: '2026-10-30', startTime: null, allDay: true });
    expect(summary).toMatchObject({ total: 3, activities: 2, scheduleBlocks: 1 });
  });
});
