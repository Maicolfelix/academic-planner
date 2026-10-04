import { describe, expect, it } from 'vitest';
import { suggestPeriodName } from './periodName';

describe('suggestPeriodName', () => {
  it('suggests the first semester from January to June', () => {
    expect(suggestPeriodName(new Date(2026, 0, 15))).toBe('Primer semestre 2026');
    expect(suggestPeriodName(new Date(2026, 5, 30))).toBe('Primer semestre 2026');
  });

  it('suggests the second semester from July to December', () => {
    expect(suggestPeriodName(new Date(2026, 6, 1))).toBe('Segundo semestre 2026');
    expect(suggestPeriodName(new Date(2026, 10, 28))).toBe('Segundo semestre 2026');
  });
});
