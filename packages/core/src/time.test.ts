import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  dueFromLocal,
  formatDue,
  localDayBounds,
  toLocalParts,
  zonedTimeToUtc,
} from './time.js';

const iso = (d: Date) => d.toISOString();
const BOGOTA = DEFAULT_TIMEZONE;

describe('dueFromLocal (Bogotá, UTC-5, no daylight saving)', () => {
  it('without a time stores the END of the local day and hasTime=false', () => {
    const r = dueFromLocal({ date: '2026-10-10' }, BOGOTA);
    expect(iso(r.dueAt)).toBe('2026-10-11T04:59:59.999Z');
    expect(r.hasTime).toBe(false);
  });

  it('with a time stores that wall time as UTC and hasTime=true', () => {
    const r = dueFromLocal({ date: '2026-10-10', time: '14:00' }, BOGOTA);
    expect(iso(r.dueAt)).toBe('2026-10-10T19:00:00.000Z');
    expect(r.hasTime).toBe(true);
  });

  it('treats an empty or null time as "no time"', () => {
    expect(dueFromLocal({ date: '2026-10-10', time: '' }, BOGOTA).hasTime).toBe(false);
    expect(dueFromLocal({ date: '2026-10-10', time: null }, BOGOTA).hasTime).toBe(false);
  });

  it('handles midnight and 23:59', () => {
    expect(iso(dueFromLocal({ date: '2026-10-10', time: '00:00' }, BOGOTA).dueAt)).toBe(
      '2026-10-10T05:00:00.000Z',
    );
    expect(iso(dueFromLocal({ date: '2026-10-10', time: '23:59' }, BOGOTA).dueAt)).toBe(
      '2026-10-11T04:59:00.000Z',
    );
  });

  it('crosses month and year boundaries correctly', () => {
    expect(iso(dueFromLocal({ date: '2026-12-31' }, BOGOTA).dueAt)).toBe(
      '2027-01-01T04:59:59.999Z',
    );
    expect(iso(dueFromLocal({ date: '2028-02-29', time: '20:00' }, BOGOTA).dueAt)).toBe(
      '2028-03-01T01:00:00.000Z',
    );
  });
});

describe('other timezones (guards against regressions when users are not in Bogotá)', () => {
  const cases: [string, string, string | undefined, string][] = [
    // zone, local date, local time, expected UTC instant
    ['UTC', '2026-10-10', '14:00', '2026-10-10T14:00:00.000Z'],
    ['Asia/Kolkata', '2026-10-10', '10:00', '2026-10-10T04:30:00.000Z'], // +05:30
    ['Pacific/Auckland', '2026-10-10', '10:00', '2026-10-09T21:00:00.000Z'], // NZDT +13
    ['America/New_York', '2026-07-15', '09:00', '2026-07-15T13:00:00.000Z'], // EDT -4
    ['America/New_York', '2026-01-15', '09:00', '2026-01-15T14:00:00.000Z'], // EST -5
    ['America/New_York', '2026-03-08', '01:30', '2026-03-08T06:30:00.000Z'], // before spring forward, EST
    ['America/New_York', '2026-03-08', '12:00', '2026-03-08T16:00:00.000Z'], // after it, EDT
    ['America/New_York', '2026-11-01', '12:00', '2026-11-01T17:00:00.000Z'], // after fall back, EST
    ['America/Los_Angeles', '2026-08-03', undefined, '2026-08-04T06:59:59.999Z'], // end of day, PDT -7
    ['Pacific/Auckland', '2026-10-10', undefined, '2026-10-10T10:59:59.999Z'], // end of day, +13
  ];

  it.each(cases)('%s %s %s -> %s', (tz, date, time, expected) => {
    expect(iso(dueFromLocal({ date, time }, tz).dueAt)).toBe(expected);
  });

  it('the same calendar day is a different instant in each zone', () => {
    const instants = new Set(
      ['America/Bogota', 'UTC', 'Asia/Kolkata', 'Pacific/Auckland'].map((tz) =>
        iso(dueFromLocal({ date: '2026-10-10' }, tz).dueAt),
      ),
    );
    expect(instants.size).toBe(4);
  });
});

describe('toLocalParts', () => {
  it('reads the wall clock of the user, not the UTC clock', () => {
    // 04:59:59.999Z on the 11th is still the 10th at 23:59 in Bogotá.
    expect(toLocalParts('2026-10-11T04:59:59.999Z', BOGOTA)).toEqual({
      date: '2026-10-10',
      time: '23:59',
    });
    expect(toLocalParts('2026-10-10T19:00:00.000Z', BOGOTA)).toEqual({
      date: '2026-10-10',
      time: '14:00',
    });
  });

  it('keeps the user’s date even when the UTC date is different', () => {
    // End of 3 Aug in Los Angeles is already the 4th in UTC; the student must still see the 3rd.
    const { dueAt } = dueFromLocal({ date: '2026-08-03' }, 'America/Los_Angeles');
    expect(dueAt.toISOString().slice(0, 10)).toBe('2026-08-04');
    expect(toLocalParts(dueAt, 'America/Los_Angeles').date).toBe('2026-08-03');
    // …and the same for a zone ahead of UTC: 10:00 on the 10th in Auckland is the 9th in UTC.
    const auckland = dueFromLocal({ date: '2026-10-10', time: '10:00' }, 'Pacific/Auckland').dueAt;
    expect(auckland.toISOString().slice(0, 10)).toBe('2026-10-09');
    expect(toLocalParts(auckland, 'Pacific/Auckland')).toEqual({
      date: '2026-10-10',
      time: '10:00',
    });
  });

  it('round-trips date and time in several zones (times that exist in every zone)', () => {
    const zones = [
      'America/Bogota',
      'UTC',
      'Asia/Kolkata',
      'Pacific/Auckland',
      'America/New_York',
      'Europe/Madrid',
    ];
    const days = [
      '2026-01-01',
      '2026-03-29',
      '2026-06-15',
      '2026-10-25',
      '2026-12-31',
      '2028-02-29',
    ];
    const times = ['00:00', '06:45', '12:00', '15:30', '23:59'];
    for (const tz of zones) {
      for (const date of days) {
        for (const time of times) {
          expect(
            toLocalParts(dueFromLocal({ date, time }, tz).dueAt, tz),
            `${tz} ${date} ${time}`,
          ).toEqual({
            date,
            time,
          });
        }
      }
    }
  });
});

describe('localDayBounds', () => {
  it('covers a Bogotá day exactly', () => {
    const { start, end } = localDayBounds('2026-10-10', BOGOTA);
    expect(iso(start)).toBe('2026-10-10T05:00:00.000Z');
    expect(iso(end)).toBe('2026-10-11T04:59:59.999Z');
  });

  it('is 23 hours long on a spring-forward day and 25 on fall-back (New York)', () => {
    const hours = (date: string) => {
      const { start, end } = localDayBounds(date, 'America/New_York');
      return (end.getTime() - start.getTime() + 1) / 3_600_000;
    };
    expect(hours('2026-03-08')).toBe(23);
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2026-06-01')).toBe(24);
  });
});

describe('zonedTimeToUtc', () => {
  it('is the inverse of the wall clock', () => {
    expect(iso(zonedTimeToUtc({ date: '2026-10-10', hour: 8, minute: 15 }, BOGOTA))).toBe(
      '2026-10-10T13:15:00.000Z',
    );
  });
});

describe('formatDue', () => {
  it('shows only the day when there is no time', () => {
    const { dueAt, hasTime } = dueFromLocal({ date: '2026-10-10' }, BOGOTA);
    const text = formatDue({ dueAt, hasTime }, BOGOTA);
    expect(text).toMatch(/10/);
    expect(text).toMatch(/oct/i);
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/:/); // the stored 23:59 is never shown
  });

  it('shows the time in the user’s timezone when there is one', () => {
    const { dueAt, hasTime } = dueFromLocal({ date: '2026-10-10', time: '14:00' }, BOGOTA);
    expect(formatDue({ dueAt, hasTime }, BOGOTA)).toMatch(/2:00/);
  });

  it('formats the same instant differently for another timezone', () => {
    const { dueAt, hasTime } = dueFromLocal({ date: '2026-10-10', time: '14:00' }, BOGOTA);
    expect(formatDue({ dueAt, hasTime }, 'UTC')).toMatch(/7:00/);
  });
});
