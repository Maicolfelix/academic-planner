import { describe, expect, it } from 'vitest';
import { SUBJECT_COLOR_VALUES, pickSubjectColor } from './academic.js';
import {
  confirmScheduleImportSchema,
  planImportSubjects,
  toScheduleBlockInput,
  type ConfirmImportClass,
} from './scheduleImportConfirm.js';

const REDES = { id: '11111111-1111-4111-8111-111111111111', name: 'Redes', color: '#3B82F6' };
const BASES = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Bases de Datos',
  color: '#EF4444',
};

const NEW = (clientId: string, name: string): Pick<ConfirmImportClass, 'clientId' | 'subject'> => ({
  clientId,
  subject: { kind: 'NEW', name },
});
const EXISTING = (
  clientId: string,
  subjectId: string,
): Pick<ConfirmImportClass, 'clientId' | 'subject'> => ({
  clientId,
  subject: { kind: 'EXISTING', subjectId },
});

const aClass = (over: Record<string, unknown> = {}) => ({
  clientId: 'a',
  weekday: 3,
  startTime: '19:00',
  endTime: '20:30',
  title: 'Proyectos II',
  until: '2026-11-28',
  subject: { kind: 'NEW', name: 'Proyectos II' },
  ...over,
});
const body = (...classes: object[]) => ({ classes });

describe('planImportSubjects', () => {
  it('a class for a subject that exists uses it and creates nothing', () => {
    const plan = planImportSubjects([EXISTING('a', REDES.id)], [REDES, BASES]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.targets).toEqual([
      { clientId: 'a', target: { kind: 'EXISTING', subjectId: REDES.id } },
    ]);
  });

  it('a NEW name that is already a subject of the period is reused, however it is written', () => {
    const plan = planImportSubjects(
      [NEW('a', 'redes'), NEW('b', '  REDES  '), NEW('c', 'Bases   de datos')],
      [REDES, BASES],
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.targets.map((t) => t.target)).toEqual([
      { kind: 'EXISTING', subjectId: REDES.id },
      { kind: 'EXISTING', subjectId: REDES.id },
      { kind: 'EXISTING', subjectId: BASES.id },
    ]);
  });

  it('several classes of the same new subject share ONE subject (normalised names, first spelling kept)', () => {
    const plan = planImportSubjects(
      [
        NEW('a', 'Proyectos II'),
        NEW('b', 'proyectos ii'),
        NEW('c', 'Proyectos   II'),
        NEW('d', 'PROYECTOS Ii'),
      ],
      [],
    );
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0]).toMatchObject({ key: 'proyectos ii', name: 'Proyectos II' });
    expect(new Set(plan.targets.map((t) => JSON.stringify(t.target))).size).toBe(1);
  });

  it('accents do not make two subjects (the same rule the database uses)', () => {
    const plan = planImportSubjects(
      [NEW('a', 'Prácticas Empresariales'), NEW('b', 'Practicas empresariales')],
      [],
    );
    expect(plan.toCreate).toHaveLength(1);
  });

  it('two different new subjects are two subjects, each with its own color', () => {
    const plan = planImportSubjects(
      [NEW('a', 'Proyectos II'), NEW('b', 'Prácticas Empresariales')],
      [],
    );
    expect(plan.toCreate.map((n) => n.name)).toEqual(['Proyectos II', 'Prácticas Empresariales']);
    expect(new Set(plan.toCreate.map((n) => n.color)).size).toBe(2);
    expect(plan.targets.map((t) => t.target)).toEqual([
      { kind: 'NEW', key: 'proyectos ii' },
      { kind: 'NEW', key: 'practicas empresariales' },
    ]);
  });

  it('is decided on the FINAL names: two cards edited to the same name are one subject', () => {
    // (the card text said "Proyecto II" and "Proyectos II"; the student wrote the same name in both)
    const final = planImportSubjects([NEW('a', 'Proyectos II'), NEW('b', 'Proyectos II')], []);
    expect(final.toCreate).toHaveLength(1);
  });

  it('never merges by similarity: "Proyecto II" and "Proyectos II" stay two subjects', () => {
    const plan = planImportSubjects([NEW('a', 'Proyecto II'), NEW('b', 'Proyectos II')], []);
    expect(plan.toCreate.map((n) => n.name)).toEqual(['Proyecto II', 'Proyectos II']);
    // and a NEW name close to an existing one does not reuse it
    const near = planImportSubjects([NEW('a', 'Red')], [REDES]);
    expect(near.toCreate).toHaveLength(1);
  });

  it('colors avoid the ones the period already uses', () => {
    const used = SUBJECT_COLOR_VALUES.slice(0, 2).map((c, i) => ({
      id: `3333333${i}-3333-4333-8333-333333333333`,
      name: `S${i}`,
      color: c,
    }));
    const plan = planImportSubjects([NEW('a', 'Nueva')], used);
    expect(plan.toCreate[0]!.color).toBe(SUBJECT_COLOR_VALUES[2]);
  });
});

describe('pickSubjectColor', () => {
  it('takes the first unused palette color, ignoring case, and starts over when all are used', () => {
    expect(pickSubjectColor([])).toBe(SUBJECT_COLOR_VALUES[0]);
    expect(pickSubjectColor([SUBJECT_COLOR_VALUES[0].toLowerCase()])).toBe(SUBJECT_COLOR_VALUES[1]);
    expect(pickSubjectColor([...SUBJECT_COLOR_VALUES])).toBe(SUBJECT_COLOR_VALUES[0]);
    expect(pickSubjectColor([...SUBJECT_COLOR_VALUES, '#3B82F6'])).toBe(SUBJECT_COLOR_VALUES[1]);
  });
});

describe('confirmScheduleImportSchema', () => {
  it('accepts a class of a NEW subject and a class of an EXISTING one', () => {
    const r = confirmScheduleImportSchema.safeParse(
      body(
        aClass(),
        aClass({
          clientId: 'b',
          subject: { kind: 'EXISTING', subjectId: REDES.id },
          title: 'Redes',
        }),
      ),
    );
    expect(r.success).toBe(true);
  });

  it('rejects an invalid name for a new subject (empty, blank, too long)', () => {
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      expect(
        confirmScheduleImportSchema.safeParse(body(aClass({ subject: { kind: 'NEW', name } })))
          .success,
      ).toBe(false);
    }
    expect(
      confirmScheduleImportSchema.safeParse(
        body(aClass({ subject: { kind: 'NEW', name: 'x'.repeat(100) } })),
      ).success,
    ).toBe(true);
  });

  it('trims the names it accepts', () => {
    const r = confirmScheduleImportSchema.parse(
      body(aClass({ subject: { kind: 'NEW', name: '  Proyectos II ' }, title: ' Proyectos II ' })),
    );
    expect(r.classes[0]).toMatchObject({
      subject: { name: 'Proyectos II' },
      title: 'Proyectos II',
    });
  });

  it('refuses anything the server must derive (mass assignment), at every level', () => {
    const attempts = [
      { ...body(aClass()), userId: REDES.id },
      { ...body(aClass()), periodId: REDES.id },
      body(aClass({ userId: REDES.id })),
      body(aClass({ periodId: REDES.id })),
      body(aClass({ subject: { kind: 'NEW', name: 'X', color: '#000000' } })),
      body(aClass({ subject: { kind: 'NEW', name: 'X', nameKey: 'x' } })),
      body(aClass({ subject: { kind: 'NEW', name: 'X', periodId: REDES.id } })),
      body(aClass({ subject: { kind: 'EXISTING', subjectId: REDES.id, name: 'X' } })),
      body(aClass({ createdAt: '2020-01-01T00:00:00.000Z' })),
    ];
    for (const a of attempts) expect(confirmScheduleImportSchema.safeParse(a).success).toBe(false);
  });

  it('refuses a malformed class', () => {
    const bad = [
      aClass({ weekday: 0 }),
      aClass({ weekday: 8 }),
      aClass({ weekday: 1.5 }),
      aClass({ startTime: '7pm' }),
      aClass({ startTime: '20:30', endTime: '19:00' }),
      aClass({ startTime: '19:00', endTime: '19:00' }),
      aClass({ title: '' }),
      aClass({ until: '2026-13-01' }),
      aClass({ clientId: '' }),
      aClass({ subject: { kind: 'EXISTING', subjectId: 'not-a-uuid' } }),
      aClass({ subject: { kind: 'OTHER', name: 'X' } }),
      aClass({ subject: undefined }),
    ];
    for (const b of bad) expect(confirmScheduleImportSchema.safeParse(body(b)).success).toBe(false);
  });

  it('needs 1 to 40 classes with distinct client ids', () => {
    expect(confirmScheduleImportSchema.safeParse(body()).success).toBe(false);
    expect(confirmScheduleImportSchema.safeParse({}).success).toBe(false);
    const many = Array.from({ length: 41 }, (_, i) => aClass({ clientId: `c${i}` }));
    expect(confirmScheduleImportSchema.safeParse(body(...many)).success).toBe(false);
    expect(confirmScheduleImportSchema.safeParse(body(...many.slice(0, 40))).success).toBe(true);
    expect(confirmScheduleImportSchema.safeParse(body(aClass(), aClass())).success).toBe(false);
  });
});

describe('toScheduleBlockInput', () => {
  it('derives the first date of the weekly series from the weekday and the period start', () => {
    // 2026-08-03 is a Monday: Wednesday = the 5th, Saturday = the 8th, Monday = the same day
    const input = (weekday: number) =>
      toScheduleBlockInput(
        { weekday, startTime: '19:00', endTime: '20:30', title: 'X', until: '2026-11-28' },
        REDES.id,
        '2026-08-03',
      );
    expect(input(3).date).toBe('2026-08-05');
    expect(input(6).date).toBe('2026-08-08');
    expect(input(1).date).toBe('2026-08-03');
    expect(input(3)).toMatchObject({
      type: 'CLASS',
      subjectId: REDES.id,
      recurrence: { frequency: 'WEEKLY', until: '2026-11-28' },
    });
  });
});
