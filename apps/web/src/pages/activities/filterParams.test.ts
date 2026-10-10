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
      radar: undefined,
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

  it('"Sin asignatura" is `subject=none`: it parses, serializes, round-trips, coexists with the rest and reaches the API', () => {
    expect(parse('subject=none')).toMatchObject({ subject: 'none' });
    const filters = { status: 'PENDING', subject: 'none', priority: 'HIGH', type: 'EXAM' } as const;
    expect(serializeFilters(filters).toString()).toBe(
      'status=PENDING&subject=none&priority=HIGH&type=EXAM',
    );
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
    expect(hasActiveFilters({ subject: 'none' })).toBe(true);
    expect(toApiQuery({ subject: 'none' }, 'p1').subjectId).toBe('none');
  });

  it('clearing the filters leaves no `subject=none` behind', () => {
    expect(serializeFilters({}).toString()).toBe('');
    expect(parseFilters(serializeFilters({})).subject).toBeUndefined();
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
      radar: undefined,
    });
    expect(toApiQuery({ overdue: true }, 'p1').overdue).toBe(true);
  });

  it('keeps the Radar category in the URL and sends it to the API; unknown values are dropped', () => {
    expect(parse('radar=IMMEDIATE').radar).toBe('IMMEDIATE');
    expect(parse('radar=COMPLETED').radar).toBeUndefined(); // finished activities have no category
    expect(parse('radar=immediate').radar).toBeUndefined();
    expect(serializeFilters({ radar: 'UPCOMING' }).toString()).toBe('radar=UPCOMING');
    expect(parseFilters(serializeFilters({ radar: 'PLANNABLE', subject: 's' }))).toMatchObject({
      radar: 'PLANNABLE',
      subject: 's',
    });
    expect(hasActiveFilters({ radar: 'OVERDUE' })).toBe(true);
    expect(toApiQuery({ radar: 'UNDER_CONTROL' }, 'p1').radar).toBe('UNDER_CONTROL');
  });
});
