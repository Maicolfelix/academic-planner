import { describe, expect, it } from 'vitest';
import { isOverdue } from './activity.js';
import { calculateProgress, dueRelativeLabel, greetingForTime, localDayDiff } from './dashboard.js';
import { dueFromLocal } from './time.js';

const at = (s: string) => new Date(s);
const BOGOTA = 'America/Bogota';

describe('calculateProgress', () => {
  it.each([
    [0, 0, 0], // nothing registered: 0, never NaN
    [1, 1, 100],
    [0, 5, 0],
    [1, 3, 33],
    [2, 3, 67],
    [18, 25, 72],
    [1, 2, 50],
    [5, 5, 100],
  ])('%i of %i -> %i%%', (completed, total, expected) => {
    expect(calculateProgress(completed, total)).toBe(expected);
  });

  it('rounds to the nearest integer', () => {
    expect(calculateProgress(1, 8)).toBe(13); // 12.5 -> 13
    expect(calculateProgress(3, 8)).toBe(38); // 37.5 -> 38
  });

  it('never claims 100% unless everything is finished', () => {
    expect(calculateProgress(199, 200)).toBe(99); // 99.5 would round to 100
    expect(calculateProgress(999, 1000)).toBe(99);
    expect(calculateProgress(200, 200)).toBe(100);
  });

  it('never shows 0% once something is finished', () => {
    expect(calculateProgress(1, 300)).toBe(1); // 0.33 would round to 0
  });

  it('is defensive against nonsense input', () => {
    expect(calculateProgress(-1, 5)).toBe(0);
    expect(calculateProgress(3, -2)).toBe(0);
    expect(calculateProgress(7, 5)).toBe(100);
  });
});

describe('greetingForTime (user’s wall clock, not the device’s, not UTC)', () => {
  // Bogotá is UTC-5: 10:00Z is 05:00 there.
  it.each([
    ['2026-06-01T09:59:00Z', 'Buenas noches'], // 04:59
    ['2026-06-01T10:00:00Z', 'Buenos días'], // 05:00
    ['2026-06-01T16:59:00Z', 'Buenos días'], // 11:59
    ['2026-06-01T17:00:00Z', 'Buenas tardes'], // 12:00
    ['2026-06-01T23:59:00Z', 'Buenas tardes'], // 18:59
    ['2026-06-02T00:00:00Z', 'Buenas noches'], // 19:00
    ['2026-06-02T04:00:00Z', 'Buenas noches'], // 23:00
  ])('Bogotá %s -> %s', (iso, expected) => {
    expect(greetingForTime(at(iso), BOGOTA)).toBe(expected);
  });

  it('the same instant greets differently in different timezones', () => {
    const instant = at('2026-06-01T20:00:00Z');
    expect(greetingForTime(instant, 'America/Bogota')).toBe('Buenas tardes'); // 15:00
    expect(greetingForTime(instant, 'Asia/Tokyo')).toBe('Buenos días'); // 05:00 next day
    expect(greetingForTime(instant, 'America/Los_Angeles')).toBe('Buenas tardes'); // 13:00
    expect(greetingForTime(instant, 'Pacific/Auckland')).toBe('Buenos días'); // 08:00 next day (UTC+12 in June)
    expect(greetingForTime(instant, 'Asia/Kolkata')).toBe('Buenas noches'); // 01:30 next day (UTC+5:30)
  });
});

describe('localDayDiff', () => {
  it('compares LOCAL calendar days, not UTC days', () => {
    // 2026-06-02T03:00Z is still the evening of 1 June in Los Angeles (UTC-7).
    const now = at('2026-06-02T03:00:00Z');
    const dueLocalToday = dueFromLocal({ date: '2026-06-01' }, 'America/Los_Angeles').dueAt; // 06-02T06:59:59.999Z
    expect(dueLocalToday.toISOString().slice(0, 10)).toBe('2026-06-02'); // UTC says "the 2nd"
    expect(localDayDiff(dueLocalToday, now, 'America/Los_Angeles')).toBe(0); // the user says "today"
    // Seen from UTC the same two instants are also on the same day (the 2nd): the answer depends on the zone given.
    expect(localDayDiff(dueLocalToday, now, 'UTC')).toBe(0);
    // From Tokyo (UTC+9) "now" is already the 2nd at noon while the deadline is the 2nd at 16:00: still the same day.
    expect(localDayDiff(dueLocalToday, now, 'Asia/Tokyo')).toBe(0);
  });

  it('two minutes apart can be different days (23:59 vs 00:01 local)', () => {
    const before = at('2026-06-02T04:59:00Z'); // 23:59 on the 1st in Bogotá
    const after = at('2026-06-02T05:01:00Z'); // 00:01 on the 2nd
    expect(localDayDiff(after, before, BOGOTA)).toBe(1);
  });

  it('counts tomorrow, yesterday and further days', () => {
    const now = at('2026-06-01T17:00:00Z'); // 12:00 on the 1st, Bogotá
    expect(localDayDiff(dueFromLocal({ date: '2026-06-01' }, BOGOTA).dueAt, now, BOGOTA)).toBe(0);
    expect(localDayDiff(dueFromLocal({ date: '2026-06-02' }, BOGOTA).dueAt, now, BOGOTA)).toBe(1);
    expect(localDayDiff(dueFromLocal({ date: '2026-06-04' }, BOGOTA).dueAt, now, BOGOTA)).toBe(3);
    expect(localDayDiff(dueFromLocal({ date: '2026-05-31' }, BOGOTA).dueAt, now, BOGOTA)).toBe(-1);
  });

  it('is exact across daylight-saving changes (a 23-hour day is still one day)', () => {
    const now = at('2026-03-07T17:00:00Z'); // 12:00 on 7 March in New York
    const due = dueFromLocal({ date: '2026-03-08', time: '12:00' }, 'America/New_York').dueAt;
    expect(localDayDiff(due, now, 'America/New_York')).toBe(1);
  });
});

describe('dueRelativeLabel', () => {
  const now = at('2026-06-01T17:00:00Z'); // 12:00 on the 1st, Bogotá
  const label = (date: string, time?: string) =>
    dueRelativeLabel(dueFromLocal({ date, time }, BOGOTA), now, BOGOTA);

  it('future deadlines', () => {
    expect(label('2026-06-01')).toBe('Vence hoy');
    expect(label('2026-06-01', '18:00')).toBe('Vence hoy');
    expect(label('2026-06-02')).toBe('Vence mañana');
    expect(label('2026-06-04')).toBe('Vence en 3 días');
  });

  it('past deadlines', () => {
    expect(label('2026-06-01', '08:00')).toBe('Venció hoy'); // earlier today
    expect(label('2026-05-31')).toBe('Venció ayer');
    expect(label('2026-05-28')).toBe('Venció hace 4 días');
  });
});

describe('overdue vs completed (the rule the Dashboard counts with)', () => {
  const now = at('2026-06-01T17:00:00Z');
  const past = '2026-05-01T00:00:00.000Z';

  it('an open activity past its deadline is overdue; a completed one never is', () => {
    expect(isOverdue({ dueAt: past, status: 'PENDING' }, now)).toBe(true);
    expect(isOverdue({ dueAt: past, status: 'IN_PROGRESS' }, now)).toBe(true);
    expect(isOverdue({ dueAt: past, status: 'COMPLETED' }, now)).toBe(false);
  });
});
