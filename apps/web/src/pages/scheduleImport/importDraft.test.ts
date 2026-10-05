import { describe, expect, it } from 'vitest';
import { endsBeforeStart, problemsOf, type ImportDraft } from './ImportProposalCard';

const draft: ImportDraft = {
  subjectId: 'x',
  weekday: '1',
  startTime: '08:00',
  endTime: '10:00',
  title: 'Redes',
  until: '2026-11-28',
};

describe('problemsOf', () => {
  it('a complete class has none', () => {
    expect(problemsOf(draft)).toEqual([]);
  });

  it('names every missing piece, in reading order', () => {
    expect(
      problemsOf({ ...draft, subjectId: '', weekday: '', startTime: '', endTime: '', title: ' ' }),
    ).toEqual(['la asignatura', 'el día', 'la hora de inicio', 'la hora de fin', 'el título']);
  });
});

describe('endsBeforeStart', () => {
  it('flags an end that is not after the start, and only when both are present', () => {
    expect(endsBeforeStart(draft)).toBe(false);
    expect(endsBeforeStart({ ...draft, endTime: '08:00' })).toBe(true);
    expect(endsBeforeStart({ ...draft, endTime: '07:00' })).toBe(true);
    expect(endsBeforeStart({ ...draft, endTime: '' })).toBe(false);
  });
});
