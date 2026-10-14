import { describe, expect, it } from 'vitest';
import { homePeriodResponseSchema } from './academic.js';

const period = {
  id: '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70',
  name: 'P',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: null,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
};

describe('the answer of GET /api/periods/home', () => {
  it('is a full period, or null when there is no home period', () => {
    expect(homePeriodResponseSchema.safeParse({ period }).success).toBe(true);
    expect(
      homePeriodResponseSchema.safeParse({
        period: { ...period, studyTrackId: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41' },
      }).success,
    ).toBe(true);
    expect(homePeriodResponseSchema.safeParse({ period: null }).success).toBe(true);
  });

  it('the field is always there: an answer without it, or with half a period, is not the contract', () => {
    expect(homePeriodResponseSchema.safeParse({}).success).toBe(false);
    expect(homePeriodResponseSchema.safeParse({ period: undefined }).success).toBe(false);
    expect(homePeriodResponseSchema.safeParse({ period: { id: period.id } }).success).toBe(false);
  });
});
