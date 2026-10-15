import { describe, expect, it } from 'vitest';
import { adoptPeriodSchema, setupStudyTrackSchema, studyPeriodSchema } from './index.js';

const U = '00000000-0000-4000-8000-000000000001';
const dates = { startDate: '2026-08-03', endDate: '2026-11-28' };
const ok = (over: object = {}) => ({
  track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
  period: { name: 'Cohorte', ...dates },
  ...over,
});

describe('setupStudyTrackSchema', () => {
  it('takes a study, its first period and optional subject names', () => {
    expect(setupStudyTrackSchema.safeParse(ok()).success).toBe(true);
    const full = setupStudyTrackSchema.parse(
      ok({
        track: { type: 'UNIVERSITY', programKey: 'medicina' },
        period: { name: '2026-2', ...dates, studyLevel: 4 },
        subjects: ['Farmacología', 'Redes'],
      }),
    );
    expect(full.subjects).toEqual(['Farmacología', 'Redes']);
    expect(full.period.studyLevel).toBe(4);
  });

  it('is strict at every level: the owner, flags, ids, context and colors are never the client’s', () => {
    for (const bad of [
      ok({ userId: U }),
      ok({ periodId: U }),
      ok({ studyTrackId: U }),
      ok({ educationContext: 'SCHOOL' }),
      ok({ track: { name: 'X', type: 'SCHOOL', isPrimary: true } }),
      ok({ track: { name: 'X', type: 'SCHOOL', status: 'ARCHIVED' } }),
      ok({ track: { name: 'X', type: 'SCHOOL', userId: U } }),
      ok({ period: { name: 'P', ...dates, isCurrent: true } }),
      ok({ period: { name: 'P', ...dates, studyTrackId: U } }),
      ok({ subjects: [{ name: 'X', color: '#EF4444' }] }),
    ]) {
      expect(setupStudyTrackSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('checks the study (a name or a real catalog key; never a personal type) and the period (name, dates in order)', () => {
    for (const bad of [
      ok({ track: { type: 'SCHOOL' } }),
      ok({ track: { name: 'X', type: 'PERSONAL' } }),
      ok({ track: { programKey: 'no-existe', type: 'UNIVERSITY' } }),
      ok({ track: { programKey: 'medicina', name: 'Derecho', type: 'UNIVERSITY' } }),
      ok({ period: { name: '', ...dates } }),
      ok({ period: { name: 'P', startDate: '2026-12-01', endDate: '2026-08-01' } }),
      ok({ period: undefined }),
      ok({ track: undefined }),
    ]) {
      expect(setupStudyTrackSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('the level is a number OR a note; at most 30 subject names', () => {
    expect(
      studyPeriodSchema.safeParse({ name: 'P', ...dates, studyLevelNote: 'Internado' }).success,
    ).toBe(true);
    expect(
      studyPeriodSchema.safeParse({ name: 'P', ...dates, studyLevel: 3, studyLevelNote: 'x' })
        .success,
    ).toBe(false);
    expect(
      setupStudyTrackSchema.safeParse(
        ok({ subjects: Array.from({ length: 31 }, (_, i) => `M${i}`) }),
      ).success,
    ).toBe(false);
    expect(
      setupStudyTrackSchema.safeParse(
        ok({ subjects: Array.from({ length: 30 }, (_, i) => `M${i}`) }),
      ).success,
    ).toBe(true);
  });
});

describe('adoptPeriodSchema', () => {
  it('a period id plus the same fields as a new study', () => {
    expect(
      adoptPeriodSchema.safeParse({ periodId: U, name: 'Medicina', type: 'UNIVERSITY' }).success,
    ).toBe(true);
    expect(
      adoptPeriodSchema.safeParse({ periodId: U, programKey: 'medicina', type: 'UNIVERSITY' })
        .success,
    ).toBe(true);
  });

  it('refuses a missing/odd period id, no name or key, and anything the server decides', () => {
    for (const bad of [
      { name: 'X', type: 'SCHOOL' },
      { periodId: 'no', name: 'X', type: 'SCHOOL' },
      { periodId: U, type: 'SCHOOL' },
      { periodId: U, name: 'X', type: 'PERSONAL' },
      { periodId: U, name: 'X', type: 'SCHOOL', userId: U },
      { periodId: U, name: 'X', type: 'SCHOOL', isPrimary: true },
      { periodId: U, name: 'X', type: 'SCHOOL', studyTrackId: U },
      { periodId: U, name: 'X', type: 'SCHOOL', status: 'ARCHIVED' },
    ]) {
      expect(adoptPeriodSchema.safeParse(bad).success).toBe(false);
    }
  });
});
