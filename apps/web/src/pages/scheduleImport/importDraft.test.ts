import { describe, expect, it } from 'vitest';
import { findSubjectByName, type ScheduleImportProposal, type Subject } from '@planner/core';
import {
  NEW_SUBJECT,
  cardErrors,
  cardField,
  endsBeforeStart,
  nameConflicts,
  newNameProblem,
  prefixEvidence,
  problemsOf,
  subjectsToCreate,
  toConfirmClass,
  type ImportDraft,
  type ImportRow,
} from './importDraft';

const draft: ImportDraft = {
  subjectId: 'x',
  newName: '',
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

const subject = (id: string, name: string) =>
  ({
    id,
    name,
    periodId: 'p',
    professor: null,
    color: '#3B82F6',
    description: null,
    createdAt: '',
    updatedAt: '',
  }) as Subject;

describe('a class of a NEW subject', () => {
  const isNew: ImportDraft = { ...draft, subjectId: NEW_SUBJECT, newName: 'Proyectos II' };

  it('is complete with a valid name; the name is what is checked, not an id', () => {
    expect(problemsOf(isNew)).toEqual([]);
    expect(problemsOf({ ...isNew, newName: '   ' })).toEqual(['el nombre de la asignatura']);
    expect(problemsOf({ ...isNew, newName: 'x'.repeat(101) })).toEqual([
      'el nombre de la asignatura',
    ]);
    expect(problemsOf({ ...isNew, newName: 'x'.repeat(100) })).toEqual([]);
    // an undecided class still names "la asignatura"
    expect(problemsOf({ ...isNew, subjectId: '' })).toEqual(['la asignatura']);
  });

  it('explains the problem with the name only for a NEW subject', () => {
    expect(newNameProblem({ ...isNew, newName: '' })).toBe('Ingresa un nombre.');
    expect(newNameProblem({ ...draft, newName: '' })).toBeUndefined();
  });

  it('is sent as { kind: NEW, name } and an existing one as { kind: EXISTING, subjectId }', () => {
    expect(toConfirmClass(isNew, '3')).toEqual({
      clientId: '3',
      weekday: 1,
      startTime: '08:00',
      endTime: '10:00',
      title: 'Redes',
      until: '2026-11-28',
      subject: { kind: 'NEW', name: 'Proyectos II' },
    });
    expect(toConfirmClass(draft, '0').subject).toEqual({ kind: 'EXISTING', subjectId: 'x' });
  });
});

describe('subjectsToCreate', () => {
  const redes = subject('1', 'Redes');
  const nuevo = (newName: string): ImportDraft => ({ ...draft, subjectId: NEW_SUBJECT, newName });

  it('lists each new name once, however it is written, and keeps the first spelling', () => {
    expect(
      subjectsToCreate([nuevo('Proyectos II'), nuevo(' proyectos  ii '), nuevo('Cálculo')], []),
    ).toEqual(['Proyectos II', 'Cálculo']);
  });

  it('a name that is already a subject creates nothing, and invalid names are ignored', () => {
    expect(subjectsToCreate([nuevo('REDES'), nuevo('   ')], [redes])).toEqual([]);
    expect(findSubjectByName('redes', [redes])).toBe(redes);
    expect(findSubjectByName('Red', [redes])).toBeUndefined(); // never by similarity
  });

  it('ignores classes of existing subjects', () => {
    expect(subjectsToCreate([draft], [redes])).toEqual([]);
  });
});

describe('cardField / cardErrors', () => {
  it('maps zod and server field keys to what the card shows', () => {
    expect(cardField('subject.name')).toBe('newName');
    expect(cardField('subject.subjectId')).toBe('subjectId');
    expect(cardField('subject')).toBe('subjectId');
    expect(cardField('until')).toBe('recurrence');
    expect(cardField('weekday')).toBe('date');
    expect(cardField('endTime')).toBe('endTime');
    expect(cardField('title')).toBe('title');
  });

  it('keeps every message, grouped by card field', () => {
    expect(
      cardErrors({ 'subject.name': ['Ingresa un nombre.'], until: ['a'], recurrence: ['b'] }),
    ).toEqual({ newName: ['Ingresa un nombre.'], recurrence: ['a', 'b'] });
  });
});

describe('different institutional codes that clean to the same name', () => {
  const row = (
    sourcePrefix: string | null,
    newName = 'Redes',
    over: Partial<ImportRow> = {},
  ): ImportRow => ({
    proposal: { proposedName: 'Redes', sourcePrefix } as ScheduleImportProposal,
    draft: { ...draft, subjectId: NEW_SUBJECT, newName },
    selected: true,
    autoTitle: true,
    status: 'idle',
    errors: {},
    liveConflicts: null,
    ...over,
  });
  const none = new Set<string>();

  it('the evidence is the removed code, only while the name is still the proposed one', () => {
    expect(prefixEvidence(row('ABCDE'))).toBe('ABCDE');
    expect(prefixEvidence(row('ABCDE', 'redes'))).toBe('ABCDE'); // same name, written another way
    expect(prefixEvidence(row('ABCDE', 'Redes A'))).toBeNull(); // the student named it: their decision
    expect(prefixEvidence(row(null))).toBeNull();
    expect(prefixEvidence({ ...row('ABCDE'), draft: { ...draft } })).toBeNull(); // an existing subject
  });

  it('two codes, one cleaned name: both cards wait for the student', () => {
    const found = nameConflicts([row('ABCDE'), row('FGHIJ')], none);
    expect([...found.keys()]).toEqual([0, 1]);
    expect(found.get(0)).toEqual({ key: 'redes', prefixes: ['ABCDE', 'FGHIJ'] });
  });

  it('the same code, no code, or different names are not conflicts', () => {
    expect(nameConflicts([row('ZISXA'), row('zisxa')], none).size).toBe(0);
    expect(nameConflicts([row(null), row(null)], none).size).toBe(0);
    expect(nameConflicts([row('ABCDE'), row('FGHIJ', 'Bases')], none).size).toBe(0);
    expect(nameConflicts([row('ABCDE')], none).size).toBe(0);
  });

  it('it resolves by confirming the same subject, or by changing a name (the student decided)', () => {
    const rows = [row('ABCDE'), row('FGHIJ')];
    expect(nameConflicts(rows, new Set(['redes'])).size).toBe(0);
    expect(nameConflicts([rows[0]!, row('FGHIJ', 'Redes B')], none).size).toBe(0);
  });

  it('a card already imported, or one with an invalid name, takes no part', () => {
    expect(
      nameConflicts([row('ABCDE'), row('FGHIJ', 'Redes', { status: 'created' })], none).size,
    ).toBe(0);
    expect(nameConflicts([row('ABCDE'), row('FGHIJ', '  ')], none).size).toBe(0);
  });

  it('the confirmation carries the evidence and the decision of a NEW subject, nothing for an existing one', () => {
    const d = row('ABCDE').draft;
    expect(toConfirmClass(d, '0', { sourcePrefix: 'ABCDE', mergeConfirmed: true }).subject).toEqual(
      {
        kind: 'NEW',
        name: 'Redes',
        sourcePrefix: 'ABCDE',
        mergeConfirmed: true,
      },
    );
    expect(toConfirmClass(d, '0').subject).toEqual({ kind: 'NEW', name: 'Redes' });
    expect(toConfirmClass(draft, '0', { sourcePrefix: 'ABCDE' }).subject).toEqual({
      kind: 'EXISTING',
      subjectId: 'x',
    });
  });
});
