import { describe, expect, it } from 'vitest';
import {
  SCALE_PRESETS,
  bpToPercentText,
  cutPresets,
  defaultCutName,
  formatNeeded,
  formatPercent,
  formatPoints,
  formatScore,
  formatUnitsPercent,
  percentToBp,
  scoreToMilli,
} from './gradingUi.js';

describe('percent ↔ basis points', () => {
  it('"40" is 4000 bp and back; a comma or a % sign is accepted', () => {
    expect(percentToBp('40')).toBe(4000);
    expect(percentToBp('12,5')).toBe(1250);
    expect(percentToBp(' 33.33 % ')).toBe(3333);
    expect(formatPercent(4000)).toBe('40 %');
    expect(formatPercent(1250)).toBe('12.5 %');
    expect(formatPercent(3333)).toBe('33.33 %');
    expect(bpToPercentText(4000)).toBe('40');
  });
  it('refuses what is not a percentage', () => {
    for (const bad of ['', 'abc', '-5', '101', '1e2', '4 0', '.5'])
      expect(percentToBp(bad), bad).toBeNull();
    expect(percentToBp('0')).toBe(0);
    expect(percentToBp('100')).toBe(10_000);
  });
  it('a weight in the final grade (units) reads as a percentage', () => {
    expect(formatUnitsPercent(60_000_000)).toBe('60 %');
    expect(formatUnitsPercent(0)).toBe('0 %');
  });
});

describe('score ↔ milli', () => {
  it('"4.2" and "4,2" are 4200; nonsense is null', () => {
    expect(scoreToMilli('4.2')).toBe(4200);
    expect(scoreToMilli('4,2')).toBe(4200);
    expect(scoreToMilli('18')).toBe(18_000);
    expect(scoreToMilli('4.2.1')).toBeNull();
    expect(scoreToMilli('')).toBeNull();
    expect(scoreToMilli('NaN')).toBeNull();
  });
  it('shows a score with the profile decimals (half up) and a need rounded UP', () => {
    expect(formatScore(4200, 1)).toBe('4.2');
    expect(formatScore(2970, 1)).toBe('3.0'); // display only: the verdict is never taken from it
    expect(formatScore(60_000, 0)).toBe('60');
    expect(formatScore(3456, 2)).toBe('3.46');
    expect(formatNeeded(2251, 1)).toBe('2.3');
    expect(formatNeeded(2250, 1)).toBe('2.3');
    expect(formatNeeded(2200, 1)).toBe('2.2');
    expect(formatPoints(18_000, 20_000)).toBe('18 / 20');
    expect(formatPoints(17_500, 20_000)).toBe('17.5 / 20');
  });
});

describe('presets', () => {
  it('the scale presets are the two common ones', () => {
    expect(SCALE_PRESETS.map((p) => [p.minMilli, p.maxMilli, p.passMilli])).toEqual([
      [0, 5000, 3000],
      [0, 100_000, 60_000],
    ]);
  });
  it('the cuts presets follow the kind of study and always add up to 100 %', () => {
    const sum = (cuts: readonly { finalShareBp: number }[]) =>
      cuts.reduce((s, c) => s + c.finalShareBp, 0);
    for (const type of ['UNIVERSITY', 'SCHOOL', 'OTHER_ACADEMIC'] as const)
      for (const preset of cutPresets(type))
        expect(sum(preset.cuts), `${type} ${preset.id}`).toBe(10_000);
    expect(cutPresets('UNIVERSITY')[0]!.cuts.map((c) => [c.name, c.finalShareBp])).toEqual([
      ['Corte 1', 3000],
      ['Corte 2', 3000],
      ['Corte 3', 4000],
    ]);
    expect(cutPresets('SCHOOL')[0]!.cuts.map((c) => c.name)).toEqual([
      'Periodo de evaluación 1',
      'Periodo de evaluación 2',
      'Periodo de evaluación 3',
      'Periodo de evaluación 4',
    ]);
    expect(cutPresets('OTHER_ACADEMIC').map((p) => p.id)).toEqual(['NONE']);
    expect(cutPresets('UNIVERSITY').at(-1)!.cuts).toEqual([
      { name: 'Nota final', finalShareBp: 10_000 },
    ]);
  });
  it('names the next cut with the term of the study', () => {
    expect(defaultCutName('UNIVERSITY', 4)).toBe('Corte 4');
    expect(defaultCutName('OTHER_ACADEMIC', 2)).toBe('Etapa 2');
  });
});
