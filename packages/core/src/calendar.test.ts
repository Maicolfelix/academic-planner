import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  firstWeekdayOnOrAfter,
  maxDate,
  minDate,
  weekdayOf,
  weekRangeOf,
} from './calendar.js';

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-10-06', 7)).toBe('2026-10-13');
  });

  it('counts days in both directions', () => {
    expect(daysBetween('2026-10-05', '2026-10-11')).toBe(6);
    expect(daysBetween('2026-10-11', '2026-10-05')).toBe(-6);
    expect(daysBetween('2026-12-25', '2027-01-05')).toBe(11);
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
  });

  it('min/max compare ISO dates chronologically', () => {
    expect(maxDate('2026-10-05', '2026-09-30')).toBe('2026-10-05');
    expect(minDate('2026-10-05', '2026-09-30')).toBe('2026-09-30');
  });
});

describe('weekdayOf (ISO: 1 = Monday … 7 = Sunday)', () => {
  it('knows the days of a known week', () => {
    // 5 October 2026 is a Monday.
    expect(
      [5, 6, 7, 8, 9, 10, 11].map((d) => weekdayOf(`2026-10-${String(d).padStart(2, '0')}`)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('weekRangeOf (a week is Monday to Sunday)', () => {
  it.each([
    ['2026-10-05', '2026-10-05', '2026-10-11'], // Monday
    ['2026-10-08', '2026-10-05', '2026-10-11'], // Thursday
    ['2026-10-11', '2026-10-05', '2026-10-11'], // Sunday belongs to the week that started on Monday 5
    ['2026-10-12', '2026-10-12', '2026-10-18'], // next Monday starts a new week
  ])('%s -> %s … %s', (day, from, to) => {
    expect(weekRangeOf(day)).toEqual({ from, to });
  });

  it('works across a month and a year change', () => {
    expect(weekRangeOf('2026-10-29')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(weekRangeOf('2026-12-31')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('firstWeekdayOnOrAfter', () => {
  it('returns the date itself when it already falls on that weekday', () => {
    expect(firstWeekdayOnOrAfter('2026-08-04', 2)).toBe('2026-08-04'); // a Tuesday
  });

  it('moves forward to the next such weekday, never backwards', () => {
    expect(firstWeekdayOnOrAfter('2026-08-03', 2)).toBe('2026-08-04'); // Mon -> Tue
    expect(firstWeekdayOnOrAfter('2026-08-05', 2)).toBe('2026-08-11'); // Wed -> next Tue
    expect(firstWeekdayOnOrAfter('2026-08-09', 1)).toBe('2026-08-10'); // Sun -> Mon
    expect(firstWeekdayOnOrAfter('2026-12-31', 5)).toBe('2027-01-01'); // year change
  });
});
