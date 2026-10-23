import { segmentDiscourse } from './captureDiscourse.js';
import { describe, expect, it } from 'vitest';
import { maskMetaText } from './captureContext.js';
import { parseCaptureProposals, type CaptureMode, type CaptureResult } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';

/**
 * "Tengo 3 actividades…" is about the text, not an activity: the count is the student's EXPECTATION (compared with what
 * is found, never used to invent), "la otra es…" / "la última es…" are position markers, a shared day is shared, and a
 * subject is only chosen on evidence. "Today" is Sunday 11 October 2026 (Bogotá); "martes" is the 13th.
 */
const NOW = new Date('2026-10-11T20:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SUBJECTS = [
  { id: id(1), name: 'Programación con PYTHON' },
  { id: id(2), name: 'Ciberseguridad' },
  { id: id(3), name: 'Redes de Computadores' },
];
const ctx = (subjects = SUBJECTS): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects,
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const run = (text: string, mode: CaptureMode = 'QUICK', subjects = SUBJECTS): CaptureResult =>
  parseCaptureProposals(text, ctx(subjects), mode);
const rows = (r: CaptureResult) =>
  r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.time.value, p.status]);

const CASE = `Tengo 3 actividades para el día martes
un taller sobre informática a las 8:00 am,
la otra es un examen de lógica de programación a las 2:00 PM,
y la última es un proyecto con Cisco a las 7:30 PM`;

describe('the contractual case: three activities for one day', () => {
  for (const mode of ['QUICK', 'INBOX'] as const) {
    it(`${mode}: exactly three proposals, each with its own title, type, hour and the shared Tuesday`, () => {
      const r = run(CASE, mode);
      expect(r.proposals).toHaveLength(3);
      expect(
        r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.time.value]),
      ).toEqual([
        ['Taller sobre informática', 'WORKSHOP', '2026-10-13', '08:00'],
        ['Examen de lógica de programación', 'EXAM', '2026-10-13', '14:00'],
        ['Proyecto con Cisco', 'PROJECT', '2026-10-13', '19:30'],
      ]);
      expect(r.warnings).toEqual([]); // 3 said, 3 found
      expect(r.stats.expected).toBe(3);
    });
  }

  it('"3 actividades" never reaches a title, nor do "la otra" or "la última"', () => {
    for (const p of run(CASE).proposals) {
      expect(p.title.value).not.toMatch(/actividades|otra|última|ultima|\b3\b/i);
      expect(p.rawSegment.length).toBeGreaterThan(0);
    }
  });

  it('the day said once is shared: all three get it, as INHERITED, and nobody is asked for it', () => {
    const r = run(CASE);
    expect(r.proposals.every((p) => p.date.value === '2026-10-13')).toBe(true);
    expect(r.proposals.slice(1).every((p) => p.date.origin === 'INHERITED')).toBe(true);
    expect(r.proposals.every((p) => p.blockingIssues.every((b) => b.field !== 'date'))).toBe(true);
  });

  // The shared day is ONE date whatever the clock says. (Bogotá is UTC-5; Tuesday is 13 October 2026, the next one the 20th.)
  // Before: on a Tuesday at 10 the 8 o'clock activity moved to next week while the 2 pm and 7:30 pm ones stayed today.
  it.each([
    ['Sunday 20:00', '2026-10-11T20:00:00Z', '2026-10-13'],
    ['Monday 23:00', '2026-10-13T04:00:00Z', '2026-10-13'],
    ['Tuesday 06:00, before every hour', '2026-10-13T11:00:00Z', '2026-10-13'],
    ['Tuesday 10:00, after the first hour', '2026-10-13T15:00:00Z', '2026-10-20'],
    ['Tuesday 16:00, after the second hour', '2026-10-13T21:00:00Z', '2026-10-20'],
    ['Tuesday 20:00, after every hour', '2026-10-14T01:00:00Z', '2026-10-20'],
    ['Wednesday 10:00', '2026-10-14T15:00:00Z', '2026-10-20'],
  ])('%s: the three share one Tuesday, %s -> %s', (_label, now, tuesday) => {
    const r = parseCaptureProposals(CASE, { ...ctx(), now: new Date(now) }, 'QUICK');
    expect(r.proposals.map((p) => [p.time.value, p.date.value])).toEqual([
      ['08:00', tuesday],
      ['14:00', tuesday],
      ['19:30', tuesday],
    ]);
  });

  // Two shared-day groups in ONE capture never touch each other, even when they are worded the same. Bogotá is UTC-5; the
  // clocks are Tuesday 13 October 2026 at 06:00, 12:00 and 20:00 (the next Tuesday is the 20th, the Thursday the 15th).
  describe('independent shared-day groups', () => {
    const SAME_WORDS = `Para el martes: un taller a las 8:00 am y un examen a las 10:00 am. Para el martes: un proyecto a las 3:00 PM y una tarea a las 5:00 PM.`;
    const SAME_WORDS_2 = `El martes tendremos un taller a las 8:00 am y un examen a las 10:00 am. El martes tendremos un proyecto a las 3:00 PM y una tarea a las 5:00 PM.`;
    const OTHER_DAY = `Para el martes: un taller a las 8:00 am y un examen a las 10:00 am. Para el jueves: un proyecto a las 3:00 PM y una tarea a las 5:00 PM.`;
    const at = (text: string, now: string) =>
      parseCaptureProposals(text, { ...ctx(), now: new Date(now) }, 'QUICK').proposals.map((p) => [
        p.time.value,
        p.date.value,
      ]);

    it.each([
      // each group uses ITS OWN earliest hour: at 12:00 the 8:00 group moved to next week, the 15:00 group did not
      [
        'Tuesday 12:00',
        '2026-10-13T17:00:00Z',
        ['2026-10-20', '2026-10-20', '2026-10-13', '2026-10-13'],
      ],
      [
        'Tuesday 06:00',
        '2026-10-13T11:00:00Z',
        ['2026-10-13', '2026-10-13', '2026-10-13', '2026-10-13'],
      ],
      [
        'Tuesday 20:00',
        '2026-10-14T01:00:00Z',
        ['2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20'],
      ],
    ])('the same words twice, %s: no group contaminates the other', (_l, now, dates) => {
      for (const text of [SAME_WORDS, SAME_WORDS_2]) {
        const r = at(text, now);
        expect(r.map((x) => x[0])).toEqual(['08:00', '10:00', '15:00', '17:00']);
        expect(r.map((x) => x[1])).toEqual(dates);
      }
    });

    it('two groups with different days: each its own day, and the hours of one never move the other', () => {
      const r = at(OTHER_DAY, '2026-10-13T17:00:00Z');
      expect(r.map((x) => x[1])).toEqual(['2026-10-20', '2026-10-20', '2026-10-15', '2026-10-15']);
      expect(at(OTHER_DAY, '2026-10-13T11:00:00Z').map((x) => x[1])).toEqual([
        '2026-10-13',
        '2026-10-13',
        '2026-10-15',
        '2026-10-15',
      ]);
    });

    // The strongest shape: ONE sentence (no full stop or semicolon) with two days. First prove the segmenter keeps every
    // activity in the same sentence, so the test attacks the grouping and not something the segmenter already separates.
    const ONE_SENTENCE = `Para el martes tengo un taller a las 8:00 am y un quiz a las 10:00 am, y para el jueves tengo un proyecto a las 3:00 pm y una tarea a las 5:00 pm.`;

    it('both families are in the same sentence', () => {
      const spans = segmentDiscourse(ONE_SENTENCE, ctx(), {
        splitLeading: true,
        implicitDetails: true,
      });
      expect(spans.filter((x) => x.role === 'INTRO')).toHaveLength(4);
      expect(new Set(spans.map((x) => x.sentenceIndex)).size).toBe(1);
    });

    it('two days in one sentence: the martes group uses its own earliest hour and the jueves activity its own day', () => {
      // Tuesday 12:00 (Bogotá): the 8:00 am one has passed, so the martes group is the 20th; the jueves one is the 15th.
      const r = at(ONE_SENTENCE, '2026-10-13T17:00:00Z');
      expect(r.map((x) => x[0])).toEqual(['08:00', '10:00', '15:00', '17:00']);
      expect(r[0]![1]).toBe('2026-10-20');
      expect(r[1]![1]).toBe('2026-10-20'); // shares the martes of the 8:00 am one
      expect(r[2]![1]).toBe('2026-10-15'); // its own day wins
      // Tuesday 06:00: nothing has passed, the martes group is today
      const early = at(ONE_SENTENCE, '2026-10-13T11:00:00Z');
      expect([early[0]![1], early[1]![1], early[2]![1]]).toEqual([
        '2026-10-13',
        '2026-10-13',
        '2026-10-15',
      ]);
    });

    it('an activity with a day of its own still wins over the shared one, and the shared group ignores it', () => {
      const text = `Tengo 3 actividades para el martes: un taller a las 3:00 PM, un examen el jueves a las 8:00 am y un proyecto a las 5:00 PM`;
      const r = parseCaptureProposals(
        text,
        { ...ctx(), now: new Date('2026-10-13T17:00:00Z') },
        'QUICK',
      );
      const byTime = Object.fromEntries(r.proposals.map((p) => [p.time.value, p.date.value]));
      expect(byTime['08:00']).toBe('2026-10-15'); // its own Thursday
      expect(byTime['15:00']).toBe('2026-10-13'); // the shared Tuesday, resolved by 15:00 and 17:00 only
      expect(byTime['17:00']).toBe('2026-10-13');
    });
  });

  it('a day of their own beats the shared one', () => {
    const r = run(
      'Tengo 3 actividades para el martes un taller a las 8 am, un examen el miércoles a las 2 pm y un proyecto a las 7:30 pm',
    );
    expect(r.proposals.map((p) => p.date.value)).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-13',
    ]);
    expect(r.proposals.map((p) => p.time.value)).toEqual(['08:00', '14:00', '19:30']);
  });

  it('the hour of each activity is its own, with the shared day (it used to be dropped as "unresolved")', () => {
    const r = run(
      'Para el martes un taller a las 8 am, un quiz a las 3 pm y un proyecto a las 7:30 pm',
    );
    expect(rows(r)).toEqual([
      ['Taller', 'WORKSHOP', '2026-10-13', '08:00', 'READY'],
      ['Quiz', 'QUIZ', '2026-10-13', '15:00', 'READY'],
      ['Proyecto', 'PROJECT', '2026-10-13', '19:30', 'READY'],
    ]);
  });
});

describe('the announced count is compared, never used to invent', () => {
  it('3 said, 2 found: COUNT_MISMATCH with the exact sentence, the 2 are kept, none ticked, no third invented', () => {
    const r = run(
      'Tengo 3 actividades para el martes: un taller a las 8 am y un examen a las 2 pm',
    );
    expect(r.proposals).toHaveLength(2);
    expect(r.warnings).toEqual([
      {
        code: 'COUNT_MISMATCH',
        message: 'Dijiste que eran 3 actividades, pero solo pude identificar 2.',
      },
    ]);
    expect(r.proposals.every((p) => p.status === 'NEEDS_REVIEW' && !p.selected)).toBe(true);
    expect(
      r.proposals.every((p) => p.blockingIssues.some((b) => b.code === 'COUNT_MISMATCH')),
    ).toBe(true);
  });

  it('2 said, 3 found: also told', () => {
    const r = run(
      'Son 2 actividades: parcial de redes el lunes, quiz el martes y taller el jueves',
    );
    expect(r.proposals).toHaveLength(3);
    expect(r.warnings[0]).toEqual({
      code: 'COUNT_MISMATCH',
      message: 'Dijiste que eran 2 actividades, pero identifiqué 3.',
    });
  });

  it('the same number: no warning, nothing blocked, everything ticked as before', () => {
    const r = run('Son 2 actividades: parcial de redes el lunes y quiz el martes');
    expect(r.warnings).toEqual([]);
    expect(r.proposals.every((p) => p.status === 'READY' && p.selected)).toBe(true);
  });

  it.each([
    ['Tengo 3 actividades para el martes', 3],
    ['Son 4 actividades: parcial lunes, quiz martes, taller jueves y tarea viernes', 4],
    ['Tengo dos cosas para el jueves: un quiz a las 8 am y un taller a las 10 am', 2],
    ['Tengo tres entregas el viernes: tarea, taller y proyecto', 3],
  ])('"%s" announces %i and the words are not part of any title', (text, expected) => {
    const r = run(text);
    expect(r.stats.expected).toBe(expected);
    for (const p of r.proposals) expect(p.title.value).not.toMatch(/actividades|cosas|entregas/i);
  });

  it('a quantity of a TYPE is not meta ("tres tareas" are three tasks); an absent count is null', () => {
    const r = run('tengo tres tareas para el viernes');
    expect(r.stats.expected).toBeNull();
    expect(r.proposals.map((p) => p.title.value)).toEqual(['Tarea', 'Tarea', 'Tarea']);
    expect(run('parcial de redes el lunes').stats.expected).toBeNull();
  });

  it('maskMetaText keeps every offset (same length) and only blanks the meta words', () => {
    const text = 'Tengo 3 actividades para el martes, la otra es un examen';
    const { text: masked, expected } = maskMetaText(text);
    expect(masked).toHaveLength(text.length);
    expect(expected).toBe(3);
    expect(masked).toContain('para el martes');
    expect(masked).toContain('un examen');
    expect(masked).not.toMatch(/actividades|la otra/);
  });
});

describe('references by position: "la otra", "la última", "la primera", "la segunda"', () => {
  it('"la otra es…" is the second activity and "la última es…" the third', () => {
    const r = run(CASE);
    expect(r.proposals.map((p) => p.title.value)).toEqual([
      'Taller sobre informática',
      'Examen de lógica de programación',
      'Proyecto con Cisco',
    ]);
  });

  it('first / second / third are markers too', () => {
    const r = run(
      'Tengo 3 actividades el jueves: la primera es un quiz a las 8 am, la segunda es un taller a las 10 am y la tercera es un parcial a las 2 pm',
    );
    expect(r.proposals.map((p) => [p.title.value, p.time.value])).toEqual([
      ['Quiz', '08:00'],
      ['Taller', '10:00'],
      ['Parcial', '14:00'],
    ]);
  });

  it('"el otro es…" with masculine nouns; and "la otra semana" is a week, not a marker', () => {
    const r = run(
      'Hay dos pendientes el viernes: un quiz a las 8 am y el otro es un taller a las 3 pm',
    );
    expect(r.proposals.map((p) => p.title.value)).toEqual(['Quiz', 'Taller']);
    expect(run('parcial de redes el jueves de la otra semana').proposals).toHaveLength(1);
  });
});

describe('a subject is chosen on evidence, not on a generic word', () => {
  const subjectOf = (text: string, subjects = SUBJECTS) => {
    const [p] = run(text, 'QUICK', subjects).proposals;
    return p!.subject;
  };

  it('"examen de lógica de programación" does NOT become "Programación con PYTHON": it asks, and every word stays', () => {
    const [p] = run('examen de lógica de programación el martes').proposals;
    expect(p!.subject).toMatchObject({ kind: 'UNRESOLVED', reason: 'AMBIGUOUS' });
    if (p!.subject.kind === 'UNRESOLVED') {
      expect(p!.subject.candidates.map((c) => c.name)).toEqual(['Programación con PYTHON']);
    }
    expect(p!.title.value).toBe('Examen de lógica de programación');
    expect(p!.status).toBe('NEEDS_REVIEW');
    expect(p!.selected).toBe(false);
  });

  it('"parcial de redes" still resolves Redes de Computadores (its words are distinctive)', () => {
    expect(subjectOf('parcial de redes el lunes')).toMatchObject({
      kind: 'EXISTING',
      name: 'Redes de Computadores',
    });
    expect(run('parcial de redes el lunes').proposals[0]!.title.value).toBe('Parcial');
  });

  it('a distinctive word of the name is evidence: "python", the exact name, and a longer phrase with it', () => {
    for (const text of [
      'tarea de python el viernes',
      'tarea de programación con python el viernes',
      'examen de programación con python el martes',
    ]) {
      expect(subjectOf(text), text).toMatchObject({
        kind: 'EXISTING',
        name: 'Programación con PYTHON',
      });
    }
  });

  it('other generic words alone ask too: informática, sistemas', () => {
    const subs = [
      { id: id(1), name: 'Sistemas Operativos' },
      { id: id(2), name: 'Informática Forense' },
    ];
    expect(subjectOf('quiz de sistemas el lunes', subs)).toMatchObject({ kind: 'UNRESOLVED' });
    expect(subjectOf('taller de informática el lunes', subs)).toMatchObject({ kind: 'UNRESOLVED' });
    expect(subjectOf('quiz de operativos el lunes', subs)).toMatchObject({
      kind: 'EXISTING',
      name: 'Sistemas Operativos',
    });
    expect(subjectOf('taller de forense el lunes', subs)).toMatchObject({ kind: 'EXISTING' });
  });

  it('a subject whose whole name is one generic word still matches exactly', () => {
    const subs = [{ id: id(1), name: 'Programación' }];
    expect(subjectOf('parcial de programación el lunes', subs)).toMatchObject({
      kind: 'EXISTING',
      name: 'Programación',
    });
  });
});

describe('the title says the type word the student wrote', () => {
  it('"examen" stays "Examen", "presentación" stays "Presentación"; a plural says the label', () => {
    expect(run('examen de redes el lunes').proposals[0]!.title.value).toBe('Examen');
    expect(run('presentación del proyecto el martes').proposals[0]!.title.value).toBe(
      'Presentación del proyecto',
    );
    expect(run('dos tareas el jueves y el viernes').proposals.map((p) => p.title.value)).toEqual([
      'Tarea',
      'Tarea',
    ]);
    expect(run('PARCIAL REDES MARTES 10AM').proposals[0]!.title.value).toBe('Parcial');
  });
});
