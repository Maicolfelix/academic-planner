import { describe, expect, it } from 'vitest';
import {
  createPeriodSchema,
  periodListResponseSchema,
  periodResponseSchema,
  periodSchema,
  updatePeriodSchema,
} from './academic.js';

const STUDY = '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41';
const valid = { name: 'Segundo semestre 2026', startDate: '2026-08-03', endDate: '2026-11-28' };
const dto = {
  id: '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70',
  name: 'P',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: null as string | null,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
};

describe('the period DTO carries its study (or none)', () => {
  it('studyTrackId is always present: a uuid, or null for a general period', () => {
    expect(periodSchema.safeParse(dto).success).toBe(true);
    expect(periodSchema.safeParse({ ...dto, studyTrackId: STUDY }).success).toBe(true);
    expect(periodResponseSchema.safeParse({ period: dto }).success).toBe(true);
    expect(
      periodListResponseSchema.safeParse({ periods: [dto, { ...dto, studyTrackId: STUDY }] })
        .success,
    ).toBe(true);
  });

  it('a period without the field, or with a malformed one, is not a period', () => {
    const without: Partial<typeof dto> = { ...dto };
    delete without.studyTrackId;
    expect(periodSchema.safeParse(without).success).toBe(false);
    expect(periodSchema.safeParse({ ...dto, studyTrackId: 'nope' }).success).toBe(false);
    expect(periodSchema.safeParse({ ...dto, studyTrackId: undefined }).success).toBe(false);
  });

  it('the other fields of the shape are exactly as before (the level stays on the period)', () => {
    expect(Object.keys(periodSchema.shape).sort()).toEqual(
      [
        'createdAt',
        'endDate',
        'id',
        'isCurrent',
        'name',
        'startDate',
        'studyLevel',
        'studyLevelNote',
        'studyTrackId',
        'updatedAt',
      ].sort(),
    );
  });
});

describe('creating a period: the study is optional', () => {
  it('omitted or null means a general period; a uuid means that study', () => {
    expect(createPeriodSchema.parse(valid).studyTrackId).toBeUndefined();
    expect(createPeriodSchema.parse({ ...valid, studyTrackId: null }).studyTrackId).toBeNull();
    expect(createPeriodSchema.parse({ ...valid, studyTrackId: STUDY }).studyTrackId).toBe(STUDY);
  });

  it('refuses a malformed study id and anything that is not a string', () => {
    for (const studyTrackId of ['nope', '', 7, true, {}]) {
      expect(createPeriodSchema.safeParse({ ...valid, studyTrackId }).success).toBe(false);
    }
  });

  it('is still strict: the owner and unknown fields are refused', () => {
    expect(createPeriodSchema.safeParse({ ...valid, userId: STUDY }).success).toBe(false);
    expect(createPeriodSchema.safeParse({ ...valid, isPrimary: true }).success).toBe(false);
    expect(createPeriodSchema.safeParse({ ...valid, studyTrack: STUDY }).success).toBe(false);
  });

  it('the rest of the contract is unchanged (dates, level, current)', () => {
    expect(createPeriodSchema.safeParse({ ...valid, endDate: '2026-08-03' }).success).toBe(false);
    expect(
      createPeriodSchema.safeParse({ ...valid, studyLevel: 4, studyLevelNote: 'x' }).success,
    ).toBe(false);
    expect(
      createPeriodSchema.safeParse({ ...valid, isCurrent: true, studyTrackId: STUDY }).success,
    ).toBe(true);
  });
});

describe('updating a period: it may move to a study or back to general', () => {
  it('a uuid moves it, null leaves it general, not mentioned changes nothing', () => {
    expect(updatePeriodSchema.parse({ studyTrackId: STUDY }).studyTrackId).toBe(STUDY);
    expect(updatePeriodSchema.parse({ studyTrackId: null }).studyTrackId).toBeNull();
    expect(updatePeriodSchema.parse({ name: 'X' }).studyTrackId).toBeUndefined();
  });

  it('refuses a malformed id, an owner and unknown fields', () => {
    expect(updatePeriodSchema.safeParse({ studyTrackId: 'nope' }).success).toBe(false);
    expect(updatePeriodSchema.safeParse({ userId: STUDY }).success).toBe(false);
    expect(updatePeriodSchema.safeParse({ isPrimary: true }).success).toBe(false);
  });

  it('can still only mark a period as current, never un-mark it, and moving combines with it', () => {
    expect(updatePeriodSchema.safeParse({ isCurrent: false }).success).toBe(false);
    expect(updatePeriodSchema.safeParse({ isCurrent: true, studyTrackId: STUDY }).success).toBe(
      true,
    );
  });
});
