import { describe, expect, it } from 'vitest';
import {
  createPeriodSchema,
  createSubjectSchema,
  formatDateOnly,
  isRealDateOnly,
  normalizeNameKey,
  updatePeriodSchema,
  updateSubjectSchema,
} from './academic.js';

const periodId = '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11';

describe('dates', () => {
  it.each(['2026-08-03', '2024-02-29', '2000-01-01'])('accepts %s', (d) => {
    expect(isRealDateOnly(d)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-10',
    '26-08-03',
    '2026-8-3',
    '1999-12-31',
    '2101-01-01',
    '',
    'hoy',
  ])('rejects %s', (d) => {
    expect(isRealDateOnly(d)).toBe(false);
  });

  it('formats day/month/year by slicing, with no timezone involved', () => {
    expect(formatDateOnly('2026-08-03')).toBe('03/08/2026');
    expect(formatDateOnly('2026-12-31')).toBe('31/12/2026');
  });
});

describe('normalizeNameKey', () => {
  it('treats case, surrounding/inner whitespace and accents as the same name', () => {
    const keys = ['Redes', ' redes ', 'REDES', 'Re  des'.replace('  ', '')].map(normalizeNameKey);
    expect(new Set(keys).size).toBe(1);
    expect(normalizeNameKey('Matemáticas  II')).toBe(normalizeNameKey('matematicas ii'));
  });

  it('keeps different names different', () => {
    expect(normalizeNameKey('Cálculo I')).not.toBe(normalizeNameKey('Cálculo II'));
  });
});

describe('createPeriodSchema', () => {
  const valid = { name: 'Segundo semestre 2026', startDate: '2026-08-03', endDate: '2026-11-28' };

  it('accepts a valid period and trims the name', () => {
    expect(createPeriodSchema.parse({ ...valid, name: '  Semestre  ' }).name).toBe('Semestre');
  });

  it.each([
    ['empty name', { name: '  ' }, 'name'],
    ['name too long', { name: 'x'.repeat(101) }, 'name'],
    ['impossible date', { startDate: '2026-02-30' }, 'startDate'],
    ['end before start', { endDate: '2026-07-01' }, 'endDate'],
    ['end equals start', { endDate: '2026-08-03' }, 'endDate'],
  ])('rejects %s', (_l, patch, field) => {
    const res = createPeriodSchema.safeParse({ ...valid, ...patch });
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  it('rejects unknown keys such as a client-sent userId', () => {
    expect(createPeriodSchema.safeParse({ ...valid, userId: 'x' }).success).toBe(false);
  });

  it('update only allows marking as current (true), never false', () => {
    expect(updatePeriodSchema.safeParse({ isCurrent: true }).success).toBe(true);
    expect(updatePeriodSchema.safeParse({ isCurrent: false }).success).toBe(false);
  });
});

describe('subject schemas', () => {
  it('applies the default color and turns empty optionals into null', () => {
    const out = createSubjectSchema.parse({
      periodId,
      name: ' Redes ',
      professor: '  ',
      description: '',
    });
    expect(out).toMatchObject({
      name: 'Redes',
      color: '#3B82F6',
      professor: null,
      description: null,
    });
  });

  it('normalises color case and rejects colors outside the palette', () => {
    expect(createSubjectSchema.parse({ periodId, name: 'A', color: '#ef4444' }).color).toBe(
      '#EF4444',
    );
    for (const color of ['red', '#FFFFFF', '#12345', 'javascript:alert(1)', '']) {
      expect(createSubjectSchema.safeParse({ periodId, name: 'A', color }).success).toBe(false);
    }
  });

  it('rejects empty/too long names and invalid periodId', () => {
    expect(createSubjectSchema.safeParse({ periodId, name: '  ' }).success).toBe(false);
    expect(createSubjectSchema.safeParse({ periodId, name: 'x'.repeat(101) }).success).toBe(false);
    expect(createSubjectSchema.safeParse({ periodId: 'nope', name: 'A' }).success).toBe(false);
  });

  it('rejects userId on create and periodId/userId on update (ownership is never client-supplied)', () => {
    expect(createSubjectSchema.safeParse({ periodId, name: 'A', userId: periodId }).success).toBe(
      false,
    );
    expect(updateSubjectSchema.safeParse({ periodId }).success).toBe(false);
    expect(updateSubjectSchema.safeParse({ userId: periodId }).success).toBe(false);
  });

  it('update distinguishes "not provided" (undefined) from "clear" (null)', () => {
    expect(updateSubjectSchema.parse({ name: 'X' })).toEqual({ name: 'X' });
    expect(updateSubjectSchema.parse({ professor: '' })).toEqual({ professor: null });
    expect(updateSubjectSchema.parse({ description: null })).toEqual({ description: null });
  });
});
