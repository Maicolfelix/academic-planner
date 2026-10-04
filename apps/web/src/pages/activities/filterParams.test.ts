import { describe, expect, it } from 'vitest';
import { hasActiveFilters, parseFilters, serializeFilters, toApiQuery } from './filterParams';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('activity filters in the URL', () => {
  it('parses valid values', () => {
    expect(parse('status=PENDING&subject=abc&priority=HIGH&type=EXAM')).toEqual({
      status: 'PENDING',
      subject: 'abc',
      priority: 'HIGH',
      type: 'EXAM',
    });
  });

  it('ignores unknown values instead of passing them to the API', () => {
    expect(parse('status=DONE&priority=URGENT&type=X')).toEqual({
      status: undefined,
      subject: undefined,
      priority: undefined,
      type: undefined,
    });
  });

  it('"overdue" and a status are mutually exclusive: overdue wins', () => {
    const f = parse('overdue=true&status=PENDING');
    expect(f.overdue).toBe(true);
    expect(f.status).toBeUndefined();
  });

  it('round-trips through the URL', () => {
    const filters = {
      status: 'IN_PROGRESS',
      subject: 's-1',
      priority: 'LOW',
      type: 'READING',
    } as const;
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
    expect(serializeFilters({ overdue: true }).toString()).toBe('overdue=true');
    expect(serializeFilters({}).toString()).toBe('');
  });

  it('knows when a filter is active', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ overdue: true })).toBe(true);
    expect(hasActiveFilters({ type: 'TASK' })).toBe(true);
  });

  it('maps to the API query, always scoped to the period', () => {
    expect(toApiQuery({ status: 'PENDING', subject: 's1', overdue: undefined }, 'p1')).toEqual({
      periodId: 'p1',
      subjectId: 's1',
      status: 'PENDING',
      priority: undefined,
      type: undefined,
      overdue: undefined,
    });
    expect(toApiQuery({ overdue: true }, 'p1').overdue).toBe(true);
  });
});
