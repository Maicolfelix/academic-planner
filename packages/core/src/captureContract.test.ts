import { describe, expect, it } from 'vitest';
import { describeTokens } from './captureContext.js';
import { parseCaptureProposals, type CaptureMode, type CaptureResult } from './captureProposals.js';
import { splitSentences } from './academicInbox.js';
import { tokenize, type QuickCaptureContext } from './captureShared.js';

/**
 * The contract of the second pass over smart capture: what the student WROTE is never lost; what they did NOT write and is
 * optional (an hour, a subject, a description) is never asked; what they wrote but could not be tied to an activity is
 * said exactly. "Today" is Monday 5 October 2026, 12:00 in Bogotá.
 */
const NOW = new Date('2026-10-05T17:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SUBJECTS = [
  { id: id(1), name: 'Redes de Computadores' },
  { id: id(2), name: 'Programación' },
  { id: id(3), name: 'Bases de Datos' },
  { id: id(4), name: 'Ciberseguridad' },
];
const ctx = (subjects = SUBJECTS): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects,
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const run = (text: string, mode: CaptureMode = 'QUICK', subjects = SUBJECTS): CaptureResult =>
  parseCaptureProposals(text, ctx(subjects), mode);
const codes = (r: CaptureResult) => r.proposals.map((p) => p.blockingIssues.map((b) => b.code));

describe('the hour the student wrote is not lost', () => {
  const TAIL = 'las dos tareas tengo que entregarlas a las 8 AM';

  it('the real case: two tasks for two different days, "las dos tareas… a las 8 AM"', () => {
    const r = run(
      `tengo dos tareas para dos días distintos, una para el jueves y otra para el viernes, ${TAIL}`,
    );
    expect(r.proposals.map((p) => [p.date.value, p.time.value, p.status])).toEqual([
      ['2026-10-08', '08:00', 'READY'],
      ['2026-10-09', '08:00', 'READY'],
    ]);
  });

  it.each([
    'las dos a las 8 AM',
    'ambas a las 8 AM',
    'esas dos tareas a las 8 AM',
    'las dos tareas son para las 8 AM',
    'las dos las entrego a las 8 AM',
    'las dos tareas tengo que entregarlas a las 8 AM',
  ])('"%s" gives 08:00 to both', (tail) => {
    const r = run(`tengo dos tareas jueves y viernes, ${tail}`);
    expect(r.proposals.map((p) => p.time.value)).toEqual(['08:00', '08:00']);
    expect(r.proposals.every((p) => p.status === 'READY')).toBe(true);
  });

  it('"ambas a las 8" with no am/pm is ONE question for the two', () => {
    const r = run('tengo dos tareas jueves y viernes, ambas a las 8');
    expect(r.proposals.map((p) => p.time.alternatives)).toEqual([
      ['08:00', '20:00'],
      ['08:00', '20:00'],
    ]);
    expect(r.corrections.filter((c) => c.field === 'time')).toHaveLength(1);
  });

  it('the contract text typed on several lines is the same activities, hour included', () => {
    const lines =
      'Tengo un examen de redes el lunes a las 7 am\ny un ensayo de ciberseguridad el martes a las 9 el martes\ny tengo dos tareas para dos dias distintos\nuno para el jueves y otro para el viernes\nlas dos tareas tengo que entregarlas a las 8 AM';
    for (const mode of ['QUICK', 'INBOX'] as const) {
      const r = run(lines, mode);
      expect(r.proposals.map((p) => [p.type.value, p.date.value, p.time.value])).toEqual([
        ['EXAM', '2026-10-12', '07:00'],
        ['TASK', '2026-10-06', null],
        ['TASK', '2026-10-08', '08:00'],
        ['TASK', '2026-10-09', '08:00'],
      ]);
    }
  });

  it('a line break between ANY two words changes nothing (fixed seed)', () => {
    const base =
      'Tengo un examen de redes el lunes a las 7 am y un ensayo de ciberseguridad el martes a las 9 el martes y tengo dos tareas para dos dias distintos uno para el jueves y otro para el viernes las dos tareas tengo que entregarlas a las 8 AM';
    const shape = (t: string, mode: CaptureMode) =>
      JSON.stringify(
        run(t, mode).proposals.map((p) => [
          p.title.value.toLowerCase(),
          p.date.value,
          p.time.value,
          p.time.alternatives,
          p.status,
        ]),
      );
    const words = base.split(' ');
    let seed = 41;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const mode of ['QUICK', 'INBOX'] as const) {
      const expected = shape(base, mode);
      for (let n = 0; n < 40; n++) {
        const breaks = new Set<number>();
        while (breaks.size < 1 + Math.floor(next() * 5))
          breaks.add(1 + Math.floor(next() * (words.length - 1)));
        const text = words
          .map((w, i) =>
            breaks.has(i) ? `\n${next() < 0.5 ? w[0]!.toUpperCase() + w.slice(1) : w}` : ` ${w}`,
          )
          .join('')
          .trim();
        expect(shape(text, mode), JSON.stringify(text)).toBe(expected);
      }
    }
  });
});

describe('optional is not missing', () => {
  it('"Tarea jueves": READY, no hour, no subject, no description, nothing to say', () => {
    const r = run('Tarea jueves');
    const [p] = r.proposals;
    expect(p).toMatchObject({
      status: 'READY',
      selected: true,
      time: { value: null, hasTime: false, alternatives: [] },
      subject: { kind: 'NONE' },
      description: { value: null, offered: null },
      blockingIssues: [],
      warnings: [],
    });
    expect(r.corrections).toEqual([]);
  });

  it('a subject and a description left out are no warning either', () => {
    const [p] = run('Parcial de redes el lunes').proposals;
    expect(p!.status).toBe('READY');
    expect(p!.warnings.map((w) => w.code)).toEqual([]);
    expect(p!.description.value).toBeNull();
  });
});

describe('written but not tied to an activity: it says exactly what', () => {
  it('hours with no day to share them are NOT treated as "no hour": UNRESOLVED_TIME_REFERENCE, with the hours offered', () => {
    const r = run('tarea a las 8 y a las 10');
    const [p] = r.proposals;
    expect(p!.status).toBe('NEEDS_REVIEW');
    expect(p!.blockingIssues.map((b) => b.code)).toContain('UNRESOLVED_TIME_REFERENCE');
    const issue = p!.blockingIssues.find((b) => b.code === 'UNRESOLVED_TIME_REFERENCE')!;
    expect(issue.field).toBe('time');
    expect(issue.message).toContain('Mencionaste horas');
    expect(issue.message).toContain('8');
    expect(issue.message).toContain('10');
    expect(p!.time.value).toBeNull();
    expect(p!.time.alternatives).toEqual(['08:00', '20:00', '10:00', '22:00']);
  });

  it('a sentence of detail that could be about two activities asks both and applies it to none', () => {
    const r = run('tengo un parcial de redes y un quiz de bases. Es a las 7 am.');
    expect(codes(r)).toEqual([
      ['DATE_MISSING', 'REFERENCE_AMBIGUOUS'],
      ['DATE_MISSING', 'REFERENCE_AMBIGUOUS'],
    ]);
    expect(r.proposals.map((p) => p.time.value)).toEqual([null, null]);
    expect(r.proposals.map((p) => p.time.alternatives)).toEqual([['07:00'], ['07:00']]);
  });

  it('a detail sentence about the only activity just completes it (Quick Capture)', () => {
    const [p] = run('tengo parcial de redes. Es el jueves a las 7 am.').proposals;
    expect(p).toMatchObject({
      status: 'READY',
      date: { value: '2026-10-08', origin: 'REFERENCE' },
      time: { value: '07:00', origin: 'REFERENCE' },
    });
  });

  it('context that could belong to either of two activities is offered, not applied: UNRESOLVED_DESCRIPTION_REFERENCE', () => {
    const r = run('tarea de redes y quiz de bases. Hay que subirlos en PDF.');
    expect(codes(r).every((c) => c.includes('UNRESOLVED_DESCRIPTION_REFERENCE'))).toBe(true);
    expect(r.proposals.every((p) => p.description.value === null)).toBe(true);
    expect(r.proposals.map((p) => p.description.offered)).toEqual([
      'Hay que subirlos en PDF',
      'Hay que subirlos en PDF',
    ]);
    const issue = r.proposals[0]!.blockingIssues.find(
      (b) => b.code === 'UNRESOLVED_DESCRIPTION_REFERENCE',
    )!;
    expect(issue.field).toBe('description');
    expect(issue.message).toContain('Hay que subirlos en PDF');
  });
});

describe('the description: only words the student wrote, in order, never forced', () => {
  it('study list after the activity', () => {
    const [p] = run(
      'Parcial de redes el lunes a las 7 am, estudiar VLAN, subnetting y routing estático',
    ).proposals;
    expect(p!.title.value).toBe('Parcial');
    expect(p!.subject).toMatchObject({ kind: 'EXISTING', name: 'Redes de Computadores' });
    expect(p!.description.value).toBe('Estudiar VLAN, subnetting y routing estático');
  });

  it('an instruction', () => {
    const [p] = run('Tarea de programación viernes, hay que subirla en PDF al campus').proposals;
    expect(p!.title.value).toBe('Tarea');
    expect(p!.description.value).toBe('Hay que subirla en PDF al campus');
  });

  it('what the professor said, and a topic, are kept', () => {
    const [p] = run('Quiz de bases martes, el profesor dijo que entra normalización').proposals;
    expect(p!.description.value).toBe('El profesor dijo que entra normalización');
  });

  it('a task with a context verb after a comma: the verb is a cue, not a second activity', () => {
    const r = run('Reunión de semillero viernes a las 3 pm, llevar el portátil');
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.description.value).toBe('Llevar el portátil');
    // ...but with a day of its own it IS an activity.
    expect(run('Tarea jueves y llevar el portátil el lunes').proposals).toHaveLength(2);
  });

  it('a description is shared by the group a reference reaches ("las dos hay que subirlas en PDF")', () => {
    const r = run('tengo dos tareas jueves y viernes. Las dos hay que subirlas en PDF.');
    expect(r.proposals.map((p) => p.description.value)).toEqual([
      'Hay que subirlas en PDF',
      'Hay que subirlas en PDF',
    ]);
    expect(
      r.proposals.every((p) => p.status === 'READY' && p.description.origin === 'REFERENCE'),
    ).toBe(true);
  });

  it('chatter is not a description: the hour and quantity phrases leave nothing behind', () => {
    const r = run(
      'tengo dos tareas para dos días distintos, una para el jueves y otra para el viernes, las dos tareas tengo que entregarlas a las 8 AM',
    );
    expect(r.proposals.map((p) => p.description.value)).toEqual([null, null]);
    expect(run('Tarea jueves a las 8').proposals[0]!.description.value).toBeNull();
  });

  it('when it is not clear whether it is context, the words are KEPT (no word of the student is lost)', () => {
    expect(
      run('Parcial de redes el lunes, unidad 3 y 4 y sistemas operativos').proposals[0]!.description
        .value,
    ).toBe('Unidad 3 y 4 y sistemas operativos');
    expect(run('Tarea jueves, la verdad no sé si la hago').proposals[0]!.description.value).toBe(
      'La verdad no sé si la hago',
    );
  });

  it('the title is never swallowed: "unidad 3" stays in it', () => {
    expect(run('Parcial de redes el lunes unidad 3 y 4').proposals[0]!.title.value).toBe(
      'Parcial unidad 3',
    );
  });

  it('casing and spacing do not change what is understood', () => {
    const a = run(
      'Parcial de redes el lunes a las 7 am, estudiar VLAN, subnetting y routing estático',
    ).proposals[0]!;
    const b = run(
      '  PARCIAL DE REDES EL LUNES A LAS 7 AM,   ESTUDIAR   VLAN,   SUBNETTING Y ROUTING ESTÁTICO ',
    ).proposals[0]!;
    expect(b.description.value?.toLowerCase().replace(/\s+/g, ' ')).toBe(
      a.description.value?.toLowerCase(),
    );
    expect([b.date.value, b.time.value]).toEqual([a.date.value, a.time.value]);
  });

  it('a long description is capped at the limit of an activity, never a failure', () => {
    const [p] = run(`Tarea jueves, estudiar ${'tema largo '.repeat(400)}`).proposals;
    expect(p!.description.value!.length).toBeLessThanOrEqual(2000);
  });

  it('the pieces compose: describeTokens finds a cue anywhere, keeps the comma, drops edge chatter', () => {
    expect(describeTokens(tokenize('y tengo que estudiar VLAN, subnetting'))).toBe(
      'Estudiar VLAN, subnetting',
    );
    expect(describeTokens(tokenize('para dos dias distintos'))).toBeNull();
    expect(describeTokens([])).toBeNull();
  });
});

describe('reading lines the way they were meant', () => {
  it('a break is not a sentence unless the sentence ended', () => {
    expect(
      splitSentences('dos tareas para dos días\nuno para el jueves\ny otro para el viernes'),
    ).toEqual(['dos tareas para dos días uno para el jueves y otro para el viernes']);
    expect(splitSentences('Tarea el jueves.\nQuiz el viernes')).toEqual([
      'Tarea el jueves.',
      'Quiz el viernes',
    ]);
  });
});
