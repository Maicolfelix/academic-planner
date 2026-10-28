import { describe, expect, it } from 'vitest';
import { firstOfMonth, monthGrid, shiftMonth } from './monthGrid';

describe('monthGrid', () => {
  it('lays October 2026 out in Monday-first weeks (it starts on a Thursday)', () => {
    const weeks = monthGrid('2026-10-01');
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.at(-1)?.at(-1)).toBeNull(); // 31 October is a Saturday
    expect(weeks.at(-1)?.[5]).toBe('2026-10-31');
  });

  it('knows leap years and months that start on a Monday', () => {
    expect(monthGrid('2028-02-01').flat().filter(Boolean)).toHaveLength(29);
    expect(monthGrid('2027-02-01').flat().filter(Boolean)).toHaveLength(28);
    expect(monthGrid('2026-06-01')[0]![0]).toBe('2026-06-01');
  });
});

describe('shiftMonth', () => {
  it('moves across the end of the year in both directions', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-10-01', 0)).toBe('2026-10-01');
    expect(shiftMonth('2026-10-01', 14)).toBe('2027-12-01');
  });

  it('firstOfMonth keeps the month of a date', () => {
    expect(firstOfMonth('2026-10-28')).toBe('2026-10-01');
  });
});
