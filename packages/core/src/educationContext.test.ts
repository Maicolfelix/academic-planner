import { describe, expect, it } from 'vitest';
import {
  EDUCATION_CONTEXTS,
  SUBJECT_BATCH_MAX,
  createSubjectBatchSchema,
  createSubjectSchema,
  dedupeSubjectNames,
  educationContextSchema,
  subjectSchema,
  updateSubjectSchema,
} from './academic.js';
import { PRIMARY_USES, primaryUseToEducationContext } from './profile.js';

const PERIOD = '00000000-0000-4000-8000-000000000001';

describe('primaryUseToEducationContext: the default of a NEW subject', () => {
  it('maps every primary use', () => {
    expect(primaryUseToEducationContext('UNIVERSITY_STUDENT')).toBe('UNIVERSITY');
    expect(primaryUseToEducationContext('SCHOOL_STUDENT')).toBe('SCHOOL');
    expect(primaryUseToEducationContext('OTHER_STUDENT')).toBe('OTHER_ACADEMIC');
    expect(primaryUseToEducationContext('TEACHER')).toBe('OTHER_ACADEMIC');
    expect(primaryUseToEducationContext('PERSONAL')).toBe('OTHER_ACADEMIC');
  });

  it('no primary use (every older account) gives null: nothing is invented', () => {
    expect(primaryUseToEducationContext(null)).toBeNull();
    expect(primaryUseToEducationContext(undefined)).toBeNull();
  });

  it('covers every primary use there is, and never yields anything but a valid context or null', () => {
    for (const use of PRIMARY_USES) {
      const ctx = primaryUseToEducationContext(use);
      expect(ctx === null || EDUCATION_CONTEXTS.includes(ctx), use).toBe(true);
    }
  });
});

describe('the education context of a subject', () => {
  it('has three values and no personal one', () => {
    expect(EDUCATION_CONTEXTS).toEqual(['UNIVERSITY', 'SCHOOL', 'OTHER_ACADEMIC']);
  });

  it('accepts the three values and nothing else', () => {
    for (const v of EDUCATION_CONTEXTS)
      expect(educationContextSchema.safeParse(v).success).toBe(true);
    for (const bad of ['PERSONAL', 'university', 'GRADED', '', 3, null, undefined]) {
      expect(educationContextSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('create: optional (omitted = default), a value, or an explicit null (not specified)', () => {
    const base = { periodId: PERIOD, name: 'Anatomía' };
    expect(createSubjectSchema.parse(base).educationContext).toBeUndefined();
    expect(
      createSubjectSchema.parse({ ...base, educationContext: 'SCHOOL' }).educationContext,
    ).toBe('SCHOOL');
    expect(
      createSubjectSchema.parse({ ...base, educationContext: null }).educationContext,
    ).toBeNull();
    expect(createSubjectSchema.safeParse({ ...base, educationContext: 'PERSONAL' }).success).toBe(
      false,
    );
    expect(createSubjectSchema.safeParse({ ...base, gradingEnabled: true }).success).toBe(false);
  });

  it('update: a value sets it, null clears it, omitted leaves it; periodId is still refused', () => {
    expect(updateSubjectSchema.parse({ educationContext: 'OTHER_ACADEMIC' }).educationContext).toBe(
      'OTHER_ACADEMIC',
    );
    expect(updateSubjectSchema.parse({ educationContext: null }).educationContext).toBeNull();
    expect(updateSubjectSchema.parse({ name: 'X' }).educationContext).toBeUndefined();
    expect(updateSubjectSchema.safeParse({ educationContext: 'x' }).success).toBe(false);
    expect(updateSubjectSchema.safeParse({ periodId: PERIOD }).success).toBe(false);
  });

  it('the subject as the API answers it always carries the field (null when not specified)', () => {
    const row = {
      id: PERIOD,
      periodId: PERIOD,
      name: 'S',
      professor: null,
      color: '#3B82F6',
      description: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(subjectSchema.safeParse({ ...row, educationContext: null }).success).toBe(true);
    expect(subjectSchema.safeParse({ ...row, educationContext: 'UNIVERSITY' }).success).toBe(true);
    expect(subjectSchema.safeParse(row).success).toBe(false);
  });
});

describe('the batch of subject names', () => {
  const ok = (v: unknown) => createSubjectBatchSchema.safeParse(v);

  it('needs 1 to 30 valid names, trimmed', () => {
    expect(SUBJECT_BATCH_MAX).toBe(30);
    expect(ok({ names: ['Anatomía'] }).success).toBe(true);
    expect(createSubjectBatchSchema.parse({ names: ['  Anatomía  '] }).names).toEqual(['Anatomía']);
    expect(ok({ names: Array.from({ length: 30 }, (_, i) => `M${i}`) }).success).toBe(true);
    expect(ok({ names: Array.from({ length: 31 }, (_, i) => `M${i}`) }).success).toBe(false);
    expect(ok({ names: [] }).success).toBe(false);
    expect(ok({}).success).toBe(false);
    expect(ok({ names: 'Anatomía' }).success).toBe(false);
  });

  it('refuses an empty, blank, over-long or NUL name, and a non-string', () => {
    for (const bad of ['', '   ', 'x'.repeat(101), 'Ana\u0000tomía', 7, null]) {
      expect(ok({ names: ['Bien', bad] }).success, String(bad)).toBe(false);
    }
    expect(ok({ names: ['x'.repeat(100)] }).success).toBe(true);
  });

  it('is strict: no owner, period, colors or primary use; one optional context for the whole batch', () => {
    for (const extra of [
      { userId: 'u' },
      { periodId: PERIOD },
      { colors: ['#3B82F6'] },
      { color: '#3B82F6' },
      { primaryUse: 'SCHOOL_STUDENT' },
      { owner: 'u' },
    ]) {
      expect(ok({ names: ['A'], ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(ok({ names: ['A'], educationContext: 'OTHER_ACADEMIC' }).success).toBe(true);
    expect(ok({ names: ['A'], educationContext: null }).success).toBe(true);
    expect(ok({ names: ['A'], educationContext: 'PERSONAL' }).success).toBe(false);
  });
});

describe('dedupeSubjectNames: one subject per normalized name, in order of first appearance', () => {
  it('collapses case, accents and spaces, keeping the first spelling', () => {
    expect(
      dedupeSubjectNames(['Farmacología', 'farmacologia', ' FARMACOLOGÍA ', 'Semiología']),
    ).toEqual([
      { name: 'Farmacología', key: 'farmacologia' },
      { name: 'Semiología', key: 'semiologia' },
    ]);
  });

  it('keeps the input order (not alphabetical)', () => {
    const out = dedupeSubjectNames(['Zoología', 'Anatomía', 'Bioética', 'zoologia', 'Filosofía']);
    expect(out.map((o) => o.name)).toEqual(['Zoología', 'Anatomía', 'Bioética', 'Filosofía']);
  });

  it('works for any names, not only the ones of a program', () => {
    const names = [
      'Asignatura Experimental 847',
      'Diseño de Sistemas Distribuidos',
      'Taller de Escritura',
      'Estadística Aplicada',
    ];
    expect(dedupeSubjectNames(names).map((o) => o.name)).toEqual(names);
  });

  it('drops blanks and handles no names', () => {
    expect(dedupeSubjectNames(['', '  ', 'A'])).toEqual([{ name: 'A', key: 'a' }]);
    expect(dedupeSubjectNames([])).toEqual([]);
  });
});
