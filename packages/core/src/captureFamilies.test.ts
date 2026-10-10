import { describe, expect, it } from 'vitest';
import { parseCaptureProposals, type CaptureMode, type CaptureResult } from './captureProposals.js';
import { segmentDiscourse } from './captureDiscourse.js';
import type { QuickCaptureContext } from './captureShared.js';

/**
 * FAMILIES of cases, not examples: the engine has to read what people really write — long, loose, without punctuation,
 * with the details in any order and said again later — and degrade usefully when it does not understand. Each family is
 * one kind of difficulty; each test inside is a different sentence of that kind.
 *
 * "Today" is Monday 5 October 2026, 12:00 in Bogotá. A morning hour that has already passed today means the SAME weekday of
 * next week (the rule that always applied), so 7 am on a Monday is the 12th.
 */
const NOW = new Date('2026-10-05T17:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const REDES = { id: id(1), name: 'Redes de Computadores' };
const PROG = { id: id(2), name: 'Programación' };
const BASES = { id: id(3), name: 'Bases de Datos' };
const CIBER = { id: id(4), name: 'Ciberseguridad' };
const SUBJECTS = [REDES, PROG, BASES, CIBER];

const ctx = (subjects = SUBJECTS): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects,
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const run = (text: string, subjects = SUBJECTS, mode: CaptureMode = 'QUICK'): CaptureResult =>
  parseCaptureProposals(text, ctx(subjects), mode);

type Row = [
  title: string,
  type: string,
  subject: string,
  date: string | null,
  time: string | null,
  status: string,
];
/** Each proposal as plain data: what it will create and whether it needs the student. */
const rows = (r: CaptureResult): Row[] =>
  r.proposals.map((p) => [
    p.title.value,
    p.type.value,
    p.subject.kind === 'EXISTING' ? p.subject.name : p.subject.kind,
    p.date.value,
    p.time.value,
    p.status,
  ]);
const issues = (r: CaptureResult) => r.proposals.map((p) => p.blockingIssues.map((b) => b.code));

describe('family 1 — one simple activity', () => {
  it.each([
    [
      'tarea de programación viernes',
      ['Tarea', 'TASK', 'Programación', '2026-10-09', null, 'READY'],
    ],
    [
      'Quiz de bases de datos mañana',
      ['Quiz', 'QUIZ', 'Bases de Datos', '2026-10-06', null, 'READY'],
    ],
    [
      'exposición el 15/10 a las 3 pm',
      ['Exposición', 'PRESENTATION', 'NONE', '2026-10-15', '15:00', 'READY'],
    ],
  ] as const)('%s', (text, expected) => {
    expect(rows(run(text))).toEqual([expected]);
  });
});

describe('family 2 — several activities in one loose sentence', () => {
  it('no punctuation, three subjects, three days', () => {
    expect(
      rows(
        run(
          'tengo parcial de redes el lunes y quiz de bases el martes y tarea de programación el viernes',
        ),
      ),
    ).toEqual([
      ['Parcial', 'EXAM', 'Redes de Computadores', '2026-10-05', null, 'READY'],
      ['Quiz', 'QUIZ', 'Bases de Datos', '2026-10-06', null, 'READY'],
      ['Tarea', 'TASK', 'Programación', '2026-10-09', null, 'READY'],
    ]);
  });

  it('a verb of having or handing in does not end up in the title', () => {
    const titles = run(
      'el lunes entrego tarea de redes y el martes presento exposición de bases',
    ).proposals.map((p) => p.title.value);
    expect(titles).toEqual(['Tarea', 'Exposición']);
  });

  it('errands and meetings are activities too, with their own hour', () => {
    expect(
      rows(
        run(
          'mañana tengo reunión con el profesor a las 3 de la tarde y entregar el informe de redes el viernes',
        ),
      ),
    ).toEqual([
      ['Reunión con el profesor', 'OTHER', 'NONE', '2026-10-06', '15:00', 'READY'],
      ['Entregar el informe', 'TASK', 'Redes de Computadores', '2026-10-09', null, 'READY'],
    ]);
  });
});

describe('family 3 — one title, several dates', () => {
  it('a bare list of days', () => {
    expect(rows(run('ensayo lunes martes y jueves')).map((r) => r[3])).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-08',
    ]);
  });

  it('the same activity word repeated with its own day each time is one activity per day', () => {
    expect(rows(run('tarea lunes tarea martes tarea miércoles')).map((r) => [r[0], r[3]])).toEqual([
      ['Tarea', '2026-10-05'],
      ['Tarea', '2026-10-06'],
      ['Tarea', '2026-10-07'],
    ]);
  });
});

describe('family 4 — groups of days and hours (2 + 2)', () => {
  const TEXT =
    'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM';

  it('the critical example is four READY activities', () => {
    const r = run(TEXT);
    expect(rows(r)).toEqual([
      ['Ensayo', 'TASK', 'NONE', '2026-10-12', '07:30', 'READY'],
      ['Ensayo', 'TASK', 'NONE', '2026-10-13', '07:30', 'READY'],
      ['Ensayo', 'TASK', 'NONE', '2026-10-15', '17:40', 'READY'],
      ['Ensayo', 'TASK', 'NONE', '2026-10-16', '17:40', 'READY'],
    ]);
    expect(r.corrections).toEqual([]);
    expect(r.proposals.every((p) => p.selected && p.blockingIssues.length === 0)).toBe(true);
  });

  it('says where each hour came from (by position)', () => {
    expect(run(TEXT).proposals.map((p) => p.time.origin)).toEqual([
      'POSITIONAL',
      'POSITIONAL',
      'POSITIONAL',
      'POSITIONAL',
    ]);
  });

  it('the same shape with other words, in the other order', () => {
    expect(
      rows(
        run(
          'taller de redes lunes, martes y jueves, el primero a las 7am y los dos últimos a las 5pm',
        ),
      ).map((r) => [r[3], r[4]]),
    ).toEqual([
      ['2026-10-12', '07:00'],
      ['2026-10-13', '17:00'],
      ['2026-10-15', '17:00'],
    ]);
  });
});

describe('family 5 — "respectivamente"', () => {
  it('pairs hours and days in order, one to one', () => {
    expect(
      rows(run('Taller de redes lunes y jueves a las 8 am y 10 am respectivamente')).map((r) => [
        r[3],
        r[4],
      ]),
    ).toEqual([
      ['2026-10-12', '08:00'],
      ['2026-10-15', '10:00'],
    ]);
  });

  it('refuses to pair when the counts differ, and asks on every day', () => {
    const r = run('Taller de redes lunes, martes y jueves a las 8 am y 10 am respectivamente');
    expect(issues(r)).toEqual(Array(3).fill(['TIME_COUNT_MISMATCH']));
  });
});

describe('family 6 — quantities', () => {
  it('"dos tareas jueves y viernes" is two tasks, one per day', () => {
    expect(rows(run('tengo dos tareas jueves y viernes')).map((r) => [r[0], r[3]])).toEqual([
      ['Tarea', '2026-10-08'],
      ['Tarea', '2026-10-09'],
    ]);
  });

  it('"tres tareas para el viernes" is three tasks on the same day (none is lost as a duplicate)', () => {
    const r = run('tengo tres tareas para el viernes');
    expect(rows(r).map((x) => x[3])).toEqual(['2026-10-09', '2026-10-09', '2026-10-09']);
    expect(r.stats.collapsed).toBe(0);
  });

  it('more tasks than days: the days are kept and the missing one is asked, not invented', () => {
    const r = run('tengo tres tareas jueves y viernes');
    expect(rows(r).map((x) => [x[3], x[5]])).toEqual([
      ['2026-10-08', 'READY'],
      ['2026-10-09', 'READY'],
      [null, 'NEEDS_REVIEW'],
    ]);
    expect(issues(r)[2]).toEqual(['QUANTITY_DATE_MISMATCH']);
    expect(
      r.proposals
        .slice(0, 2)
        .every((p) => p.warnings.some((w) => w.code === 'QUANTITY_DATE_MISMATCH')),
    ).toBe(true);
  });

  it('more days than tasks: the days win, with a warning', () => {
    const r = run('tengo dos tareas jueves viernes y sábado');
    expect(r.proposals).toHaveLength(3);
    expect(
      r.proposals.every((p) => p.warnings.some((w) => w.code === 'QUANTITY_DATE_MISMATCH')),
    ).toBe(true);
  });

  it('"una tarea el jueves y otra el viernes" is two', () => {
    expect(
      rows(run('tengo una tarea el jueves y otra el viernes')).map((x) => [x[0], x[3]]),
    ).toEqual([
      ['Tarea', '2026-10-08'],
      ['Tarea', '2026-10-09'],
    ]);
  });
});

describe('family 7 — references to what was said before', () => {
  it('contract 2: "el parcial de redes es a las 7" and "el ensayo es a las 5 de la tarde" complete the two activities', () => {
    const r = run(
      'tengo un parcial de redes para el dia jueves de la otra semana y un ensayo de ciberseguridad para el lunes el parcial de redes es a las 7:00 AM y el ensayo es a las 5 de la tarde',
    );
    expect(rows(r)).toEqual([
      ['Parcial', 'EXAM', 'Redes de Computadores', '2026-10-15', '07:00', 'READY'],
      ['Ensayo', 'TASK', 'Ciberseguridad', '2026-10-05', '17:00', 'READY'],
    ]);
    expect(r.proposals.map((p) => p.time.origin)).toEqual(['REFERENCE', 'REFERENCE']);
  });

  it('contract 3: examen + ensayo + dos tareas + "las dos tareas" later is four activities', () => {
    const r = run(
      'Tengo un examen de redes el lunes a las 7 am y un ensayo de ciberseguridad el martes a las 9 el martes y tengo dos tareas para dos dias distintos uno para el jueves y otro para el viernes las dos tareas tengo que entregarlas a las 8 AM',
    );
    expect(rows(r)).toEqual([
      ['Parcial', 'EXAM', 'Redes de Computadores', '2026-10-12', '07:00', 'READY'],
      ['Ensayo', 'TASK', 'Ciberseguridad', '2026-10-06', null, 'NEEDS_REVIEW'],
      ['Tarea', 'TASK', 'NONE', '2026-10-08', '08:00', 'READY'],
      ['Tarea', 'TASK', 'NONE', '2026-10-09', '08:00', 'READY'],
    ]);
    // The essay's "9" has no am/pm: the only thing asked.
    expect(r.proposals[1]!.time.alternatives).toEqual(['09:00', '21:00']);
    expect(issues(r)[1]).toEqual(['TIME_AMBIGUOUS']);
  });

  it('"las dos" with no noun refers to the group of two', () => {
    const r = run('tengo dos tareas jueves y viernes. las dos son a las 8 am');
    expect(rows(r).map((x) => [x[3], x[4]])).toEqual([
      ['2026-10-08', '08:00'],
      ['2026-10-09', '08:00'],
    ]);
  });

  it('"una tarea el jueves y otra el viernes, las dos a las 8 am" reaches both', () => {
    expect(
      rows(run('tengo una tarea el jueves y otra el viernes las dos a las 8 am')).map((x) => x[4]),
    ).toEqual(['08:00', '08:00']);
  });

  it('a hand-over of the hour shared by the group is ONE question when it has no am/pm', () => {
    const r = run('tengo dos tareas jueves y viernes las dos a las 8');
    expect(r.proposals.map((p) => p.time.alternatives)).toEqual([
      ['08:00', '20:00'],
      ['08:00', '20:00'],
    ]);
    expect(r.corrections.filter((c) => c.field === 'time')).toHaveLength(1);
    expect(r.corrections[0]!.clientIds).toEqual(['p1', 'p2']);
  });
});

describe('family 8 — details given after', () => {
  it('in a following sentence', () => {
    expect(
      rows(
        run(
          'tengo un parcial de redes y un ensayo de ciberseguridad. El parcial es jueves a las 7 am y el ensayo lunes a las 5 pm.',
        ),
      ),
    ).toEqual([
      ['Parcial', 'EXAM', 'Redes de Computadores', '2026-10-08', '07:00', 'READY'],
      ['Ensayo', 'TASK', 'Ciberseguridad', '2026-10-05', '17:00', 'READY'],
    ]);
  });
});

describe('family 9 — details in any order', () => {
  it('"el jueves es el parcial a las 7 y el lunes el ensayo a las 5"', () => {
    expect(
      rows(
        run(
          'parcial de redes y ensayo de ciberseguridad, el jueves es el parcial a las 7 am y el lunes el ensayo a las 5 pm',
        ),
      ),
    ).toEqual([
      ['Parcial', 'EXAM', 'Redes de Computadores', '2026-10-08', '07:00', 'READY'],
      ['Ensayo', 'TASK', 'Ciberseguridad', '2026-10-05', '17:00', 'READY'],
    ]);
  });
});

describe('family 10 — redundancy is tolerated', () => {
  it('"el martes a las 9 el martes" is one day', () => {
    const r = run('ensayo de ciberseguridad el martes a las 9 am el martes');
    expect(rows(r)).toEqual([['Ensayo', 'TASK', 'Ciberseguridad', '2026-10-06', '09:00', 'READY']]);
  });

  it('a word said twice in a row adds nothing, not even to the title', () => {
    expect(rows(run('Parcial de redes martes martes a las 7 am redes'))).toEqual([
      ['Parcial', 'EXAM', 'Redes de Computadores', '2026-10-06', '07:00', 'READY'],
    ]);
    expect(run('Parcial jueves jueves').proposals).toHaveLength(1);
  });

  it('is not a duplicate issue and nothing is collapsed', () => {
    const r = run('ensayo martes martes');
    expect(r.stats.collapsed).toBe(0);
    expect(r.warnings).toEqual([]);
  });
});

describe('family 11 — long, with no punctuation at all', () => {
  it('reads a run-on sentence of seven things', () => {
    const r = run(
      'mañana quiz de bases y el martes parcial de redes y el miércoles tarea de programación y el jueves ensayo de ciberseguridad y el viernes taller de redes y el sábado lectura de bases y el domingo proyecto de programación',
    );
    expect(r.proposals.map((p) => p.type.value)).toEqual([
      'QUIZ',
      'EXAM',
      'TASK',
      'TASK',
      'WORKSHOP',
      'READING',
      'PROJECT',
    ]);
    expect(r.proposals.every((p) => p.status === 'READY' && p.date.value !== null)).toBe(true);
  });
});

describe('family 12 — contradictions are asked, never resolved', () => {
  it('two days for the same activity: both are kept', () => {
    const r = run('el parcial es lunes y después dice el parcial es martes');
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0]!;
    expect(p.status).toBe('NEEDS_REVIEW');
    expect(p.date).toMatchObject({ value: null, certainty: 'AMBIGUOUS' });
    expect(p.date.alternatives).toEqual(['2026-10-05', '2026-10-06']);
    expect(issues(r)).toEqual([['CONFLICTING_DATE']]);
  });

  it('two hours for the same activity: both are kept', () => {
    const r = run(
      'tengo un parcial de redes el lunes a las 7 am y el parcial de redes es a las 8 am',
    );
    const p = r.proposals[0]!;
    expect(p.time).toMatchObject({
      value: null,
      certainty: 'AMBIGUOUS',
      alternatives: ['07:00', '08:00'],
    });
    expect(issues(r)).toEqual([['CONFLICTING_TIME']]);
  });

  it('the same thing said twice is NOT a contradiction', () => {
    const r = run(
      'tengo un parcial de redes el lunes a las 7 am y el parcial de redes es a las 7 am',
    );
    expect(r.proposals[0]).toMatchObject({ status: 'READY' });
  });
});

describe('family 13 — the subject', () => {
  it('named and existing: used', () => {
    expect(run('parcial de redes martes').proposals[0]!.subject).toMatchObject({
      kind: 'EXISTING',
    });
  });
  it('not named: none, nothing to ask', () => {
    const p = run('parcial martes').proposals[0]!;
    expect(p.subject).toMatchObject({ kind: 'NONE', reason: 'NOT_MENTIONED' });
    expect(p.status).toBe('READY');
  });
  it('named but unknown: asks only about it', () => {
    const [p] = run('parcial de criptografía martes').proposals;
    expect(p!.subject).toMatchObject({
      kind: 'UNRESOLVED',
      reason: 'UNKNOWN_NAME',
      suggestedName: 'Criptografía',
    });
    expect(p!.blockingIssues.map((b) => b.field)).toEqual(['subject']);
  });
  it('the subject said by a later clause completes the activity', () => {
    const r = run(
      'tengo un parcial el lunes y un ensayo el martes. el parcial de redes es a las 7 am',
    );
    expect(r.proposals[0]!.subject).toMatchObject({
      kind: 'EXISTING',
      name: REDES.name,
      origin: 'REFERENCE',
    });
  });
});

describe('family 14 — hours without am/pm', () => {
  it.each([
    ['ensayo lunes a las 6', ['06:00', '18:00']],
    ['ensayo lunes 7:30', ['07:30', '19:30']],
    ['ensayo lunes a las 12', ['00:00', '12:00']],
  ])('%s', (text, alternatives) => {
    const p = run(text).proposals[0]!;
    expect(p.time).toMatchObject({ certainty: 'AMBIGUOUS', alternatives });
    expect(p.blockingIssues.map((b) => b.code)).toEqual(['TIME_AMBIGUOUS']);
  });

  it('days that share one such hour share ONE question', () => {
    const r = run('ensayo lunes, martes y jueves a las 7:30');
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0]).toMatchObject({ field: 'time', clientIds: ['p1', 'p2', 'p3'] });
  });
});

describe('family 15 — recurrence is a suggestion', () => {
  it('"todos los martes y jueves" creates nothing', () => {
    const r = run('Ciberseguridad todos los martes y jueves a las 8 am');
    expect(r.proposals).toEqual([]);
    expect(r.suggestions).toHaveLength(1);
  });
  it('"martes y jueves a las 6" with a subject only flags the possibility', () => {
    const r = run('Ciberseguridad martes y jueves a las 6 pm');
    expect(r.suggestions).toEqual([]);
    expect(r.proposals.every((p) => p.possibleRecurrence)).toBe(true);
  });
});

describe('family 16 — partial success', () => {
  it('four understood and one in doubt: five proposals, four READY', () => {
    const r = run(
      'parcial de redes martes, quiz de bases miércoles, tarea de programación jueves, lectura viernes y parcial de criptografía sábado',
    );
    expect(r.proposals.map((p) => p.status)).toEqual([
      'READY',
      'READY',
      'READY',
      'READY',
      'NEEDS_REVIEW',
    ]);
    expect(r.proposals.slice(0, 4).every((p) => p.selected)).toBe(true);
  });

  it('a reference nobody can place only asks the activities it could have been', () => {
    const r = run(
      'tengo un parcial de redes jueves y otro parcial de bases viernes. el parcial es a las 7 am',
    );
    expect(issues(r)).toEqual([['REFERENCE_AMBIGUOUS'], ['REFERENCE_AMBIGUOUS']]);
    // The hour is offered, not applied.
    expect(r.proposals.map((p) => [p.time.value, p.time.alternatives])).toEqual([
      [null, ['07:00']],
      [null, ['07:00']],
    ]);
  });
});

describe('family 17 — the limit', () => {
  it('eleven activities are reported, never cut', () => {
    const text = Array.from(
      { length: 11 },
      (_, i) =>
        `tarea ${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][i % 7]} del taller ${i}`,
    ).join(', ');
    const r = run(text, []);
    expect(['OK', 'TOO_MANY_PROPOSALS']).toContain(r.status);
    if (r.status === 'OK') expect(r.proposals.length).toBeLessThanOrEqual(10);
  });
  it('quantity counts toward it: twelve tasks are too many', () => {
    expect(run('tengo doce tareas para el viernes', []).proposals.length).toBeLessThanOrEqual(10);
    const r = run('tengo 9 tareas para el viernes y 2 quices para el lunes', []);
    expect(r.status).toBe('TOO_MANY_PROPOSALS');
    expect(r.proposals).toEqual([]);
  });
});

describe('family 18 — determinism and noise', () => {
  const TEXTS = [
    'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
    'tengo un parcial de redes para el dia jueves de la otra semana y un ensayo de ciberseguridad para el lunes el parcial de redes es a las 7:00 AM y el ensayo es a las 5 de la tarde',
    'Tengo un examen de redes el lunes a las 7 am y un ensayo de ciberseguridad el martes a las 9 el martes y tengo dos tareas para dos dias distintos uno para el jueves y otro para el viernes las dos tareas tengo que entregarlas a las 8 AM',
  ];
  /** Title case is the student's own; everything else must be identical. */
  const shape = (text: string) =>
    run(text, SUBJECTS, 'INBOX').proposals.map((p) => [
      p.title.value.toLowerCase(),
      p.type.value,
      p.subject.kind === 'EXISTING' ? p.subject.id : p.subject.kind,
      p.date.value,
      p.time.value,
      p.time.alternatives,
      p.status,
    ]);

  it('the same text gives the same proposals', () => {
    for (const t of TEXTS) expect(run(t, SUBJECTS, 'INBOX')).toEqual(run(t, SUBJECTS, 'INBOX'));
  });

  it.each([
    ['upper case', (t: string) => t.toUpperCase()],
    ['lower case', (t: string) => t.toLowerCase()],
    ['extra spaces', (t: string) => `  ${t.replace(/ /g, '   ')}  `],
    ['accents removed', (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')],
    ['a comma before every "y"', (t: string) => t.replace(/ y /g, ', y ')],
    ['a final period', (t: string) => `${t}.`],
    ['a day said twice in a row', (t: string) => t.replace(/martes/, 'martes martes')],
  ])('%s does not change what is understood', (_name, change) => {
    for (const t of TEXTS) expect(shape(change(t)), t).toEqual(shape(t));
  });

  it('is stable across many random orderings of independent clauses (fixed seed)', () => {
    // Independent activities, each with its own day: their order in the text is their order in the result.
    const clauses = [
      'parcial de redes el lunes',
      'quiz de bases el martes',
      'tarea de programación el miércoles',
      'ensayo de ciberseguridad el jueves',
    ];
    let seed = 20261005;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 25; n++) {
      const order = [...clauses].sort(() => next() - 0.5);
      const r = run(order.join(' y '), SUBJECTS, 'INBOX');
      expect(r.proposals).toHaveLength(4);
      // Every activity keeps ITS day and ITS subject, whatever the order.
      for (const p of r.proposals) {
        const expected = {
          EXAM: ['2026-10-05', 'Redes de Computadores'],
          QUIZ: ['2026-10-06', 'Bases de Datos'],
        }[p.type.value as 'EXAM' | 'QUIZ'];
        if (expected) {
          expect(p.date.value).toBe(expected[0]);
          expect(p.subject.kind === 'EXISTING' && p.subject.name).toBe(expected[1]);
        }
      }
    }
  });
});

describe('the discourse layer', () => {
  const spans = (text: string) => segmentDiscourse(text, ctx());

  it('a definite noun phrase that matches an earlier one refers to it; an indefinite one introduces', () => {
    const s = spans('tengo un parcial de redes el lunes y el parcial de redes es a las 7 am');
    expect(s.map((x) => x.role)).toEqual(['INTRO', 'REFER']);
    expect(s[1]!.targets).toEqual([0]);
  });

  it('two different subjects are two activities even with an article', () => {
    const s = spans('el parcial de redes es el lunes y el parcial de bases el martes');
    expect(s.map((x) => x.role)).toEqual(['INTRO', 'INTRO']);
  });

  it('a pronoun with a quantity refers to the group of that size', () => {
    const s = spans('tengo dos tareas jueves y viernes. las dos son a las 8');
    expect(s.map((x) => [x.role, x.count])).toEqual([
      ['INTRO', 2],
      ['REFER', 2],
    ]);
    expect(s[1]!.targets).toEqual([0]);
  });

  it('a reference that could be two activities says so and chooses none', () => {
    const s = spans(
      'un parcial de redes jueves y otro parcial de bases viernes. el parcial es a las 7',
    );
    const ref = s.at(-1)!;
    expect(ref.role).toBe('REFER');
    expect(ref.ambiguous).toBe(true);
    expect(ref.targets).toHaveLength(2);
  });

  it('"a las dos" is a time, not a reference to two things', () => {
    const s = spans('tengo tarea el lunes a las dos');
    expect(s).toHaveLength(1);
  });

  it('a delivery verb stays with its noun: "entregar el ensayo" is ONE activity', () => {
    expect(spans('entregar el ensayo el viernes')).toHaveLength(1);
  });
});
