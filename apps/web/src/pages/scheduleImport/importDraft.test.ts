import { describe, expect, it } from 'vitest';
import { findSubjectByName, type Subject } from '@planner/core';
import {
  NEW_SUBJECT,
  cardErrors,
  cardField,
  endsBeforeStart,
  newNameProblem,
  problemsOf,
  subjectsToCreate,
  toConfirmClass,
  type ImportDraft,
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
