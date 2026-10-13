import { describe, expect, it } from 'vitest';
import {
  STUDY_LEVEL_MAX,
  STUDY_LEVEL_MIN,
  STUDY_LEVEL_NOTE_MAX,
  createPeriodSchema,
  periodSchema,
  resolveStudyLevel,
  studyLevelSchema,
  updatePeriodSchema,
} from './academic.js';

const valid = { name: 'Segundo semestre 2026', startDate: '2026-08-03', endDate: '2026-11-28' };
const create = (extra: object) => createPeriodSchema.safeParse({ ...valid, ...extra });
const update = (body: object) => updatePeriodSchema.safeParse(body);
const issues = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (r.success ? [] : r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

describe('study level: a number', () => {
  it('accepts whole numbers from 1 to 99 (no semester-style cap of 10)', () => {
    expect([STUDY_LEVEL_MIN, STUDY_LEVEL_MAX]).toEqual([1, 99]);
    for (const n of [1, 4, 10, 11, 12, 20, 99])
      expect(studyLevelSchema.safeParse(n).success, `${n}`).toBe(true);
  });

  it('refuses zero, negatives, huge values, decimals, strings and other types', () => {
    for (const bad of [
      0,
      -1,
      -10,
      100,
      1e9,
      4.5,
      0.5,
      Number.NaN,
      Infinity,
      '4',
      '',
      true,
      [],
      {},
    ]) {
      expect(studyLevelSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('creating a period with a level', () => {
  it('both fields are optional: a period without them is valid (the current onboarding sends none)', () => {
    const r = createPeriodSchema.parse(valid);
    expect(r.studyLevel).toBeUndefined();
    expect(r.studyLevelNote).toBeUndefined();
  });

  it('accepts a number, a note, or explicit nulls', () => {
    expect(create({ studyLevel: 4 }).success).toBe(true);
    expect(create({ studyLevelNote: 'Internado' }).success).toBe(true);
    expect(create({ studyLevel: null, studyLevelNote: null }).success).toBe(true);
    expect(create({ studyLevel: 4, studyLevelNote: null }).success).toBe(true);
    expect(create({ studyLevel: null, studyLevelNote: 'Internado' }).success).toBe(true);
  });

  it('the note is trimmed, and blank means none (it is never stored empty)', () => {
    expect(
      createPeriodSchema.parse({ ...valid, studyLevelNote: '  Internado  ' }).studyLevelNote,
    ).toBe('Internado');
    expect(createPeriodSchema.parse({ ...valid, studyLevelNote: '' }).studyLevelNote).toBeNull();
    expect(
      createPeriodSchema.parse({ ...valid, studyLevelNote: '    ' }).studyLevelNote,
    ).toBeNull();
  });

  it('refuses a note over the limit or with a NUL; the limit itself is fine', () => {
    expect(STUDY_LEVEL_NOTE_MAX).toBe(40);
    expect(create({ studyLevelNote: 'x'.repeat(40) }).success).toBe(true);
    expect(create({ studyLevelNote: 'x'.repeat(41) }).success).toBe(false);
    expect(create({ studyLevelNote: 'Inter\u0000nado' }).success).toBe(false);
    expect(create({ studyLevelNote: 4 }).success).toBe(false);
  });

  it('a number and a note are alternatives: both at once is refused', () => {
    expect(issues(create({ studyLevel: 4, studyLevelNote: 'Quinto' }))).toEqual([
      'studyLevelNote: Indica el nivel como número o como texto, no los dos a la vez.',
    ]);
  });

  it('refuses a bad number on creation, and keeps the other rules and strictness', () => {
    for (const studyLevel of [0, -2, 100, 2.5, '3'])
      expect(create({ studyLevel }).success).toBe(false);
    expect(create({ userId: 'u' }).success).toBe(false);
    expect(create({ semester: 4 }).success).toBe(false);
    expect(create({ endDate: '2026-08-03', studyLevel: 4 }).success).toBe(false);
  });
});

describe('updating a period with a level', () => {
  it('accepts a number, a note, nulls, and no level at all', () => {
    expect(update({ studyLevel: 5 }).success).toBe(true);
    expect(update({ studyLevelNote: 'Otro' }).success).toBe(true);
    expect(update({ studyLevel: null }).success).toBe(true);
    expect(update({ studyLevelNote: null }).success).toBe(true);
    expect(update({ name: 'Nuevo' }).success).toBe(true);
  });

  it('refuses both at once, bad numbers, long notes, NUL and unknown fields', () => {
    expect(update({ studyLevel: 4, studyLevelNote: 'Quinto' }).success).toBe(false);
    for (const studyLevel of [0, -1, 100, 1.5, '4'])
      expect(update({ studyLevel }).success).toBe(false);
    expect(update({ studyLevelNote: 'x'.repeat(41) }).success).toBe(false);
    expect(update({ studyLevelNote: 'a\u0000b' }).success).toBe(false);
    expect(update({ grade: 10 }).success).toBe(false);
  });

  it('a blank note in an update means "clear it"', () => {
    expect(updatePeriodSchema.parse({ studyLevelNote: '   ' }).studyLevelNote).toBeNull();
  });
});

describe('resolveStudyLevel: the ergonomic semantics', () => {
  const none = { studyLevel: null, studyLevelNote: null };
  const four = { studyLevel: 4, studyLevelNote: null };
  const custom = { studyLevel: null, studyLevelNote: 'Internado' };

  it('a number sets the level and clears the note', () => {
    expect(resolveStudyLevel(none, { studyLevel: 4 })).toEqual(four);
    expect(resolveStudyLevel(custom, { studyLevel: 7 })).toEqual({
      studyLevel: 7,
      studyLevelNote: null,
    });
  });

  it('a note sets the note and clears the level (numeric -> custom, with ONE field)', () => {
    expect(resolveStudyLevel(four, { studyLevelNote: 'Internado' })).toEqual(custom);
    expect(resolveStudyLevel(none, { studyLevelNote: 'Internado' })).toEqual(custom);
  });

  it('null clears that field, so clearing the active one leaves both empty', () => {
    expect(resolveStudyLevel(custom, { studyLevelNote: null })).toEqual(none);
    expect(resolveStudyLevel(four, { studyLevel: null })).toEqual(none);
  });

  it('null on the inactive field changes nothing', () => {
    expect(resolveStudyLevel(four, { studyLevelNote: null })).toEqual(four);
    expect(resolveStudyLevel(custom, { studyLevel: null })).toEqual(custom);
  });

  it('an explicit pair (one value, one null) is honoured, and not mentioning it leaves it alone', () => {
    expect(resolveStudyLevel(custom, { studyLevel: 3, studyLevelNote: null })).toEqual({
      studyLevel: 3,
      studyLevelNote: null,
    });
    expect(resolveStudyLevel(four, { studyLevel: null, studyLevelNote: 'Otro' })).toEqual({
      studyLevel: null,
      studyLevelNote: 'Otro',
    });
    expect(resolveStudyLevel(four, {})).toEqual(four);
    expect(resolveStudyLevel(custom, {})).toEqual(custom);
  });

  it('never yields both, whatever the history', () => {
    const steps = [
      { studyLevel: 3 },
      { studyLevelNote: 'A' },
      { studyLevel: null },
      { studyLevelNote: 'B' },
      { studyLevel: 9 },
      { studyLevelNote: null },
      {},
    ];
    let state: { studyLevel: number | null; studyLevelNote: string | null } = none;
    for (const patch of steps) {
      state = resolveStudyLevel(state, patch);
      expect(state.studyLevel !== null && state.studyLevelNote !== null).toBe(false);
    }
  });
});

describe('the period as the API answers it', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'P',
    startDate: '2026-08-03',
    endDate: '2026-11-28',
    isCurrent: true,
    studyTrackId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  it('always carries both fields (null when not set)', () => {
    expect(periodSchema.safeParse({ ...row, studyLevel: null, studyLevelNote: null }).success).toBe(
      true,
    );
    expect(periodSchema.safeParse({ ...row, studyLevel: 4, studyLevelNote: null }).success).toBe(
      true,
    );
    expect(
      periodSchema.safeParse({ ...row, studyLevel: null, studyLevelNote: 'Otro' }).success,
    ).toBe(true);
    expect(periodSchema.safeParse(row).success).toBe(false); // an answer without them is not the contract
  });
});
