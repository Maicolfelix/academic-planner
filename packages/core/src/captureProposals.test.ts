import { describe, expect, it } from 'vitest';
import { parseAcademicInbox } from './academicInbox.js';
import {
  CAPTURE_MAX_PROPOSALS,
  captureRequestSchema,
  captureResultSchema,
  computeCorrections,
  markExistingDuplicates,
  parseCaptureProposals,
  type CaptureMode,
  type CaptureProposal,
  type CaptureResult,
} from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';
import { parseQuickCapture } from './quickCapture.js';

// "Today" is Monday 5 October 2026, 12:00 in Bogotá (UTC-5): the standard day of the capture tests.
const NOW = new Date('2026-10-05T17:00:00.000Z');
const SATURDAY = new Date('2026-10-10T17:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const REDES = { id: id(1), name: 'Redes de Computadores' };
const PROG = { id: id(2), name: 'Programación' };
const BASES = { id: id(3), name: 'Bases de Datos' };
const CIBER = { id: id(4), name: 'Ciberseguridad' };
const SUBJECTS = [REDES, PROG, BASES, CIBER];

const ctx = (subjects = SUBJECTS, now = NOW): QuickCaptureContext => ({
  now,
  timeZone: 'America/Bogota',
  subjects,
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const run = (text: string, subjects = SUBJECTS, mode: CaptureMode = 'QUICK', now = NOW) =>
  parseCaptureProposals(text, ctx(subjects, now), mode);

/** The structure of a proposal that matters, compared as plain data (no giant snapshots). */
const view = (p: CaptureProposal) => ({
  title: p.title.value,
  type: p.type.value,
  date: p.date.value,
  time: p.time.value,
  status: p.status,
});
const views = (r: CaptureResult) => r.proposals.map(view);
const subjectOf = (p: CaptureProposal) =>
  p.subject.kind === 'EXISTING' ? p.subject.name : p.subject.kind;
const blocking = (p: CaptureProposal) => p.blockingIssues.map((b) => b.code);

describe('the critical example: four days, two hours by position', () => {
  const TEXT =
    'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM';

  it('is exactly four proposals with the right day and the right hour each', () => {
    const r = run(TEXT, [REDES, PROG]); // no subject named: that is the only thing left to say
    expect(r.status).toBe('OK');
    expect(r.suggestions).toEqual([]);
    expect(
      r.proposals.map((p) => ({ title: p.title.value, date: p.date.value, time: p.time.value })),
    ).toEqual([
      { title: 'Ensayo', date: '2026-10-12', time: '07:30' }, // lunes
      { title: 'Ensayo', date: '2026-10-13', time: '07:30' }, // martes
      { title: 'Ensayo', date: '2026-10-15', time: '17:40' }, // jueves
      { title: 'Ensayo', date: '2026-10-16', time: '17:40' }, // viernes
    ]);
  });

  it('reads the same on a Saturday (no "moved to next week" involved)', () => {
    const r = run(TEXT, [REDES, PROG], 'QUICK', SATURDAY);
    expect(r.proposals.map((p) => [p.date.value, p.time.value])).toEqual([
      ['2026-10-12', '07:30'],
      ['2026-10-13', '07:30'],
      ['2026-10-15', '17:40'],
      ['2026-10-16', '17:40'],
    ]);
    expect(r.proposals.flatMap((p) => p.warnings.map((w) => w.code))).not.toContain(
      'MOVED_TO_NEXT_WEEK',
    );
  });

  it('shares ONE group and keeps each time with its days (the temporal model)', () => {
    const r = run(TEXT, [REDES, PROG]);
    expect(new Set(r.proposals.map((p) => p.groupId))).toEqual(new Set(['g1']));
    expect(r.proposals.map((p) => p.time.groupKey)).toEqual(['g1:t0', 'g1:t0', 'g1:t1', 'g1:t1']);
    expect(r.proposals.every((p) => p.time.certainty === 'EXACT' && p.time.hasTime)).toBe(true);
  });

  it('asks ONE thing, once, for the four: the subject (they all lack it), nothing else', () => {
    const r = run(TEXT, [REDES, PROG]);
    expect(r.proposals.map(blocking)).toEqual(Array(4).fill(['SUBJECT_MISSING']));
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0]).toMatchObject({
      field: 'subject',
      key: 'MISSING',
      clientIds: ['p1', 'p2', 'p3', 'p4'],
    });
    expect(r.proposals.every((p) => p.status === 'NEEDS_REVIEW' && !p.selected)).toBe(true);
  });

  it('with the subject written, the four are READY and ticked: nothing to touch, just "Crear 4"', () => {
    const r = run(
      'Ensayo de redes el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
    );
    expect(r.proposals).toHaveLength(4);
    expect(r.proposals.every((p) => p.status === 'READY' && p.selected)).toBe(true);
    expect(r.proposals.every((p) => blocking(p).length === 0)).toBe(true);
    expect(r.proposals.every((p) => subjectOf(p) === REDES.name)).toBe(true);
    expect(r.corrections).toEqual([]);
  });

  it('with no subjects at all, it is a general activity and the four are READY', () => {
    const r = run(TEXT, []);
    expect(r.proposals.every((p) => p.status === 'READY' && p.subject.kind === 'NONE')).toBe(true);
    expect(r.proposals[0]!.subject).toMatchObject({ kind: 'NONE', reason: 'NO_SUBJECTS' });
  });
});

describe('days and hours', () => {
  const T = (text: string, subjects = SUBJECTS) =>
    run(text, subjects).proposals.map((p) => [p.date.value, p.time.value, p.status] as const);

  it('a time written after each run of days belongs to that run ("lunes y martes a las 7, jueves a las 4 y viernes a las 6")', () => {
    const r = run('Taller de redes lunes y martes a las 7, jueves a las 4 y viernes a las 6');
    expect(r.proposals.map((p) => [p.date.value, p.time.alternatives])).toEqual([
      ['2026-10-05', ['07:00', '19:00']],
      ['2026-10-06', ['07:00', '19:00']],
      ['2026-10-08', ['16:00', '04:00']],
      ['2026-10-09', ['18:00', '06:00']],
    ]);
    // Monday and Tuesday share one question; Thursday and Friday each have their own.
    expect(r.proposals.map((p) => p.time.groupKey)).toEqual(['g1:t0', 'g1:t0', 'g1:t1', 'g1:t2']);
    expect(r.corrections.filter((c) => c.field === 'time')).toEqual([
      expect.objectContaining({
        key: 'g1:t0',
        clientIds: ['p1', 'p2'],
        alternatives: ['07:00', '19:00'],
      }),
    ]);
  });

  it('a shared time: "lunes, miércoles y viernes a las 8 am"', () => {
    expect(T('Taller de redes lunes, miércoles y viernes a las 8 am')).toEqual([
      ['2026-10-12', '08:00', 'READY'],
      ['2026-10-14', '08:00', 'READY'],
      ['2026-10-16', '08:00', 'READY'],
    ]);
  });

  it('a range: "lunes a viernes" and "de lunes a viernes" are five days, in Spanish week order', () => {
    const week = [
      ['2026-10-12', '08:00', 'READY'],
      ['2026-10-13', '08:00', 'READY'],
      ['2026-10-14', '08:00', 'READY'],
      ['2026-10-15', '08:00', 'READY'],
      ['2026-10-16', '08:00', 'READY'],
    ];
    expect(T('Taller de redes lunes a viernes a las 8 am')).toEqual(week);
    expect(T('Taller de redes de lunes a viernes a las 8am')).toEqual(week);
    expect(run('Taller de redes lunes a viernes a las 8 am').proposals[0]!.title.value).toBe(
      'Taller',
    );
  });

  it('"respectivamente": the hours go to the days in order', () => {
    expect(T('Taller de redes lunes y jueves a las 8 am y 10 am respectivamente')).toEqual([
      ['2026-10-12', '08:00', 'READY'],
      ['2026-10-15', '10:00', 'READY'],
    ]);
    // Without am/pm each one is still its own question.
    const r = run('Taller de redes lunes y jueves a las 8 y 10 respectivamente');
    expect(r.proposals.map((p) => p.time.alternatives)).toEqual([
      ['08:00', '20:00'],
      ['10:00', '22:00'],
    ]);
  });

  it('"respectivamente" with a different number of hours and days pairs nothing: every day asks', () => {
    const r = run('Taller de redes lunes, martes y jueves a las 8 am y 10 am respectivamente');
    expect(r.proposals.map(blocking)).toEqual(Array(3).fill(['TIME_COUNT_MISMATCH']));
    expect(r.proposals.every((p) => p.time.value === null && p.status === 'NEEDS_REVIEW')).toBe(
      true,
    );
    // The days themselves are still right.
    expect(r.proposals.map((p) => p.date.value)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-08',
    ]);
  });

  it('"los dos últimos", "el primero", "el resto": by position from either end', () => {
    expect(
      T('Taller de redes lunes, martes y jueves, los dos últimos a las 5pm y el primero a las 7am'),
    ).toEqual([
      ['2026-10-12', '07:00', 'READY'],
      ['2026-10-13', '17:00', 'READY'],
      ['2026-10-15', '17:00', 'READY'],
    ]);
    expect(
      T('Taller de redes lunes, martes y jueves, el primero a las 7am y el resto a las 5pm'),
    ).toEqual([
      ['2026-10-12', '07:00', 'READY'],
      ['2026-10-13', '17:00', 'READY'],
      ['2026-10-15', '17:00', 'READY'],
    ]);
  });

  it('a group that cannot be distributed only marks the days it affects', () => {
    const r = run(
      'Taller de redes lunes, martes, jueves y viernes, los dos primeros a las 7am y los otros tres a las 5pm',
    );
    expect(r.proposals.map((p) => [p.date.value, p.time.value, p.status])).toEqual([
      ['2026-10-12', '07:00', 'READY'],
      ['2026-10-13', '07:00', 'READY'],
      ['2026-10-15', null, 'NEEDS_REVIEW'],
      ['2026-10-16', null, 'NEEDS_REVIEW'],
    ]);
    expect(r.proposals.slice(2).map(blocking)).toEqual([
      ['TIME_COUNT_MISMATCH'],
      ['TIME_COUNT_MISMATCH'],
    ]);
  });

  it('an hour with no am/pm is AMBIGUOUS with both readings; it is never turned into 06:00', () => {
    const [p] = run('Taller de redes martes a las 6').proposals;
    expect(p!.time).toMatchObject({
      value: null,
      hasTime: false,
      certainty: 'AMBIGUOUS',
      alternatives: ['18:00', '06:00'],
    });
    expect(blocking(p!)).toEqual(['TIME_AMBIGUOUS']);
    expect(p!.status).toBe('NEEDS_REVIEW');
  });

  it('what is not ambiguous stays certain: "6 pm", "18", "7:30", "a las 14"', () => {
    for (const [text, time] of [
      ['Taller de redes martes a las 6 pm', '18:00'],
      ['Taller de redes martes a las 18', '18:00'],
      ['Taller de redes martes 7:30', '07:30'],
      ['Taller de redes martes a las 14', '14:00'],
    ] as const) {
      const [p] = run(text).proposals;
      expect(p!.time.value, text).toBe(time);
      expect(p!.status, text).toBe('READY');
    }
  });

  it('four days that share one ambiguous hour are ONE correction', () => {
    const r = run('Taller de redes lunes, martes, jueves y viernes a las 6');
    expect(r.proposals).toHaveLength(4);
    expect(r.corrections).toEqual([
      expect.objectContaining({
        field: 'time',
        key: 'g1:t0',
        clientIds: ['p1', 'p2', 'p3', 'p4'],
        alternatives: ['18:00', '06:00'],
      }),
    ]);
  });
});

describe('several activities, one text', () => {
  it('"parcial martes y exposición jueves": two activities, each with its own title and type', () => {
    const r = run('Parcial martes y exposición jueves');
    expect(views(r).map(({ status: _s, ...rest }) => rest)).toEqual([
      { title: 'Parcial', type: 'EXAM', date: '2026-10-06', time: null },
      { title: 'Exposición', type: 'PRESENTATION', date: '2026-10-08', time: null },
    ]);
    expect(r.proposals.map((p) => p.groupId)).toEqual(['g1', 'g2']);
  });

  it('"parcial de redes martes y tarea de programación jueves": each takes its own subject', () => {
    const r = run('Parcial de redes martes y tarea de programación jueves');
    expect(r.proposals.map((p) => [p.type.value, subjectOf(p), p.date.value, p.status])).toEqual([
      ['EXAM', 'Redes de Computadores', '2026-10-06', 'READY'],
      ['TASK', 'Programación', '2026-10-08', 'READY'],
    ]);
  });

  it('"entregar informe lunes, exposición martes y reunión viernes": three activities (a meeting is an activity too)', () => {
    const r = run('entregar informe lunes, exposición martes y reunión viernes', []);
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.status])).toEqual([
      ['Entregar informe', 'TASK', '2026-10-05', 'READY'],
      ['Exposición', 'PRESENTATION', '2026-10-06', 'READY'],
      ['Reunión', 'OTHER', '2026-10-09', 'READY'],
    ]);
  });

  it('"parcial martes, exposición jueves y reunión de semillero viernes": the third is not swallowed by the second', () => {
    const r = run('Parcial martes, exposición jueves y reunión de semillero viernes');
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value])).toEqual([
      ['Parcial', 'EXAM', '2026-10-06'],
      ['Exposición', 'PRESENTATION', '2026-10-08'],
      ['Reunión de semillero', 'OTHER', '2026-10-09'],
    ]);
    // The three lack the same subject: one decision for all.
    expect(r.corrections).toEqual([
      expect.objectContaining({ field: 'subject', key: 'MISSING', clientIds: ['p1', 'p2', 'p3'] }),
    ]);
  });

  it('an activity with no activity word before another one is its own: "ensayo lunes y reunión martes"', () => {
    const r = run('Ensayo lunes y reunión martes', []);
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.groupId])).toEqual([
      ['Ensayo', 'TASK', '2026-10-05', 'g1'],
      ['Reunión', 'OTHER', '2026-10-06', 'g2'],
    ]);
    const withSubject = run('Ciberseguridad martes y reunión jueves');
    expect(withSubject.proposals.map((p) => [p.title.value, subjectOf(p), p.date.value])).toEqual([
      ['Ciberseguridad', 'Ciberseguridad', '2026-10-06'],
      ['Reunión', 'UNRESOLVED', '2026-10-08'],
    ]);
  });

  it('but what a sentence says once is still shared: "el martes a las 10 am tendremos parcial y quiz"', () => {
    const r = run('El martes a las 10 am tendremos parcial y quiz', []);
    expect(r.proposals.map((p) => [p.type.value, p.date.value, p.time.value])).toEqual([
      ['EXAM', '2026-10-06', '10:00'],
      ['QUIZ', '2026-10-06', '10:00'],
    ]);
  });

  it('the same title on several days is inherited: "ensayo lunes, martes y jueves" is three of one group', () => {
    const r = run('Ensayo lunes, martes y jueves', []);
    expect(r.proposals.map((p) => [p.title.value, p.date.value, p.groupId])).toEqual([
      ['Ensayo', '2026-10-05', 'g1'],
      ['Ensayo', '2026-10-06', 'g1'],
      ['Ensayo', '2026-10-08', 'g1'],
    ]);
  });

  it('"parcial martes y jueves": one activity on two days', () => {
    const r = run('parcial martes y jueves', []);
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value])).toEqual([
      ['Parcial', 'EXAM', '2026-10-06'],
      ['Parcial', 'EXAM', '2026-10-08'],
    ]);
  });

  it('never says "Captura rápida admite una actividad a la vez."', () => {
    for (const text of [
      'parcial martes y exposición jueves',
      'Parcial de redes martes y tarea de programación jueves',
    ]) {
      expect(JSON.stringify(run(text))).not.toContain('una actividad a la vez');
    }
  });
});

describe('the subject', () => {
  it('a subject that is named is applied (EXACT) with no question', () => {
    const [p] = run('Tarea de programación viernes').proposals;
    expect(p!.subject).toMatchObject({ kind: 'EXISTING', id: PROG.id, certainty: 'EXACT' });
    expect(p!.status).toBe('READY');
  });

  it('a subject that is not mentioned is NEEDS_REVIEW with the subject as the only issue', () => {
    const [p] = run('Tarea el viernes').proposals;
    expect(p!.subject).toMatchObject({
      kind: 'UNRESOLVED',
      reason: 'MISSING',
      suggestedName: null,
    });
    expect(blocking(p!)).toEqual(['SUBJECT_MISSING']);
    expect(p!.status).toBe('NEEDS_REVIEW');
  });

  it('a student with no subjects at all gets a general activity, decided, with no question', () => {
    const [p] = run('Llevar documentos el viernes', []).proposals;
    expect(p!.subject).toMatchObject({ kind: 'NONE', reason: 'NO_SUBJECTS' });
    expect(p).toMatchObject({ status: 'READY', selected: true });
  });

  it('a subject that does not exist: the proposal still exists, says so and offers the name', () => {
    const [p] = run('Parcial de ciberseguridad martes', [REDES, PROG]).proposals;
    expect(p!.subject).toMatchObject({
      kind: 'UNRESOLVED',
      reason: 'UNKNOWN_NAME',
      suggestedName: 'Ciberseguridad',
    });
    expect(p!.title.value).toBe('Parcial');
    expect(p!.date.value).toBe('2026-10-06');
    expect(blocking(p!)).toEqual(['SUBJECT_UNKNOWN']);
    expect(p!.blockingIssues[0]!.message).toContain('Ciberseguridad');
    expect(p!.status).toBe('NEEDS_REVIEW');
  });

  it('a name is only offered after "de": "parcial unidad 3", "parcial final" and "parcial de unidad 3" are not subjects', () => {
    for (const text of [
      'Parcial unidad 3 martes',
      'Parcial final martes',
      'Parcial de unidad 3 martes',
    ]) {
      const [p] = run(text, [REDES, PROG]).proposals;
      expect(p!.subject, text).toMatchObject({
        kind: 'UNRESOLVED',
        reason: 'MISSING',
        suggestedName: null,
      });
    }
  });

  it('several subjects that fit are AMBIGUOUS, with the candidates, never an arbitrary pick', () => {
    const subjects = [
      { id: id(10), name: 'Programación I' },
      { id: id(11), name: 'Programación II' },
    ];
    const [p] = run('Parcial programación martes', subjects).proposals;
    expect(p!.subject).toMatchObject({ kind: 'UNRESOLVED', reason: 'AMBIGUOUS' });
    expect(p!.subject.kind === 'UNRESOLVED' && p!.subject.candidates.map((c) => c.name)).toEqual([
      'Programación I',
      'Programación II',
    ]);
    expect(blocking(p!)).toEqual(['SUBJECT_AMBIGUOUS']);
  });

  it('two activities that lack the same thing share one correction; one that is alone does not get one', () => {
    const two = run('Parcial martes y tarea jueves', [REDES, PROG]);
    expect(two.corrections).toHaveLength(1);
    const one = run('Parcial martes', [REDES, PROG]);
    expect(one.corrections).toEqual([]);
  });
});

describe('the title', () => {
  it('when only the subject is left it is the title (LIKELY), never an empty card', () => {
    const [p] = run('ciberseguridad martes').proposals;
    expect(p!.title).toMatchObject({ value: 'Ciberseguridad', certainty: 'LIKELY' });
    expect(p!.warnings.map((w) => w.code)).toContain('TITLE_FROM_SUBJECT');
    expect(p!.status).toBe('READY');
  });

  it('an activity with no words at all is INVALID (no title), not NEEDS_REVIEW', () => {
    const [p] = run('martes', []).proposals;
    expect(blocking(p!)).toEqual(['TITLE_MISSING']);
    expect(p!.status).toBe('INVALID');
  });

  it('an unknown type is the usual default with an informative warning that does NOT block', () => {
    const [p] = run('Ensayo martes', []).proposals;
    expect(p!.type).toMatchObject({ value: 'TASK', certainty: 'MISSING', origin: 'DEFAULT' });
    expect(p!.warnings.map((w) => w.code)).toContain('TYPE_DEFAULTED');
    expect(p!.status).toBe('READY');
  });
});

describe('recurrence: detected, shown, never persisted or assumed', () => {
  it('"ciberseguridad todos los martes y jueves" is a suggestion, not two one-off activities', () => {
    const r = run('Ciberseguridad todos los martes y jueves');
    expect(r.proposals).toEqual([]);
    expect(r.suggestions).toHaveLength(1);
    const [s] = r.suggestions;
    expect(s!.subject).toMatchObject({ kind: 'EXISTING', name: 'Ciberseguridad' });
    expect(s!.slots.map((x) => x.weekday)).toEqual([2, 4]);
    expect(s!.evidence).toEqual(['todos los']);
    // What a weekly block needs and the text did not say stays missing: never invented.
    expect(s!.until.value).toBeNull();
    expect(s!.missing).toEqual(['startTime', 'endTime', 'until']);
  });

  it('"este semestre" gives the end of the repetition: the period\'s last day', () => {
    const [s] = run(
      'Tengo ciberseguridad todos los martes y jueves a las 8 am este semestre',
    ).suggestions;
    expect(s!.until).toMatchObject({ value: '2026-11-28', certainty: 'LIKELY' });
    expect(s!.slots).toEqual([
      { weekday: 2, time: { value: '08:00', certainty: 'EXACT', alternatives: [] } },
      { weekday: 4, time: { value: '08:00', certainty: 'EXACT', alternatives: [] } },
    ]);
    expect(s!.missing).toEqual(['endTime']);
  });

  it('"cada martes" and "semanal" are also strong evidence', () => {
    expect(run('Ciberseguridad cada martes').suggestions).toHaveLength(1);
    expect(run('Ciberseguridad semanalmente los martes').suggestions).toHaveLength(1);
  });

  it('a recurrence that has no subject yet says so', () => {
    const [s] = run('Todos los martes y jueves a las 8 am', [REDES]).suggestions;
    expect(s!.missing).toContain('subject');
  });

  it('"subject + several days" with no activity type is a POSSIBLE class: the activities are still proposed', () => {
    const r = run('Ciberseguridad martes y jueves a las 6');
    expect(r.suggestions).toEqual([]);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals.every((p) => p.possibleRecurrence)).toBe(true);
  });

  it('it is not assumed when a type is written, or for a single day', () => {
    expect(
      run('Parcial martes y jueves', [REDES]).proposals.every((p) => !p.possibleRecurrence),
    ).toBe(true);
    expect(run('Ciberseguridad martes').proposals[0]!.possibleRecurrence).toBe(false);
  });

  it('a plural article before a weekday ("los martes") is only a hint', () => {
    const r = run('Taller de redes los martes y jueves');
    expect(r.suggestions).toEqual([]);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals.every((p) => p.possibleRecurrence)).toBe(true);
  });
});

describe('the limit and the edges', () => {
  const eleven =
    'tarea lunes, tarea martes, tarea miércoles, tarea jueves, tarea viernes, taller lunes, taller martes, taller miércoles, taller jueves, taller viernes, quiz sábado';

  it('more than 10 proposals is TOO_MANY_PROPOSALS: nothing is truncated in silence', () => {
    const r = run(eleven, []);
    expect(r.status).toBe('TOO_MANY_PROPOSALS');
    expect(r.proposals).toEqual([]);
    expect(r.warnings[0]).toEqual({
      code: 'TOO_MANY_PROPOSALS',
      message: 'Encontré más de 10 actividades. Divide el mensaje en dos partes.',
    });
    expect(r.stats.found).toBe(11);
  });

  it('exactly 10 is fine', () => {
    const ten = eleven.replace(', quiz sábado', '');
    const r = run(ten, []);
    expect(r.status).toBe('OK');
    expect(r.proposals).toHaveLength(CAPTURE_MAX_PROPOSALS);
  });

  it('the same day said twice is one proposal; identical activities collapse and are counted', () => {
    expect(run('Taller martes y martes', []).proposals).toHaveLength(1);
    const r = run('Parcial martes. Parcial martes.', [], 'INBOX');
    expect(r.proposals).toHaveLength(1);
    expect(r.stats.collapsed).toBe(1);
  });

  it('an empty text, and a text over the limit of its mode', () => {
    expect(run('   ').status).toBe('EMPTY');
    expect(run('x'.repeat(301)).status).toBe('TOO_LONG');
    expect(run('x'.repeat(301), SUBJECTS, 'INBOX').status).not.toBe('TOO_LONG'); // a pasted message may be longer
    expect(run('x'.repeat(5001), SUBJECTS, 'INBOX').status).toBe('TOO_LONG');
  });

  it('an impossible date is INVALID, said with its words, and the rest of the text still reads', () => {
    const [p] = run('Taller de redes 31/02', SUBJECTS).proposals;
    expect(p!.status).toBe('INVALID');
    expect(p!.blockingIssues.map((b) => b.code)).toContain('DATE_INVALID');
    expect(p!.blockingIssues.find((b) => b.code === 'DATE_INVALID')!.message).toContain('31/02');
  });

  it('a date with no day is NEEDS_REVIEW (something to say), not an error', () => {
    const [p] = run('Taller de redes', SUBJECTS).proposals;
    expect(blocking(p!)).toEqual(['DATE_MISSING']);
    expect(p!.status).toBe('NEEDS_REVIEW');
  });

  it('informative warnings never block: a past date is READY with a warning', () => {
    const [p] = run('Taller de redes 01/09/2026', SUBJECTS).proposals;
    expect(p!.warnings.map((w) => w.code)).toContain('PAST_DATE');
    expect(p!.status).toBe('READY');
  });
});

describe('it is the same engine as before for one plain activity (no regression)', () => {
  const legacySubjects = [
    { id: id(21), name: 'Redes de Computadores' },
    { id: id(22), name: 'Bases de Datos' },
    { id: id(23), name: 'Anatomía' },
    { id: id(24), name: 'Programación' },
    { id: id(25), name: 'Epidemiología' },
    { id: id(26), name: 'Inmunología' },
    { id: id(27), name: 'Bioestadística' },
  ];

  it.each([
    'parcial redes martes 10am',
    'tarea bases viernes',
    'quiz anatomia mañana 8am',
    'proyecto programacion 15/10',
    'exposicion epidemiologia jueves 2pm',
    'lectura inmunologia hoy',
    'taller bioestadistica 20/10 14:30',
    'parcial redes unidad 3 martes 10am',
  ])('%s: the same title, type, subject, date and time as quick capture always gave', (text) => {
    const legacy = parseQuickCapture(text, ctx(legacySubjects));
    const r = run(text, legacySubjects);
    expect(r.proposals).toHaveLength(1);
    const [p] = r.proposals;
    expect(p).toMatchObject({
      title: { value: legacy.title },
      type: { value: legacy.type },
      date: { value: legacy.dueDate },
      time: { value: legacy.dueTime },
      status: 'READY',
    });
    expect(p!.subject.kind === 'EXISTING' && p!.subject.id).toBe(legacy.subjectId);
  });

  it('"Tarea de programación mañana a las 4" is one proposal, its subject right, its hour a question', () => {
    const r = run('Tarea de programación mañana a las 4');
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({
      title: { value: 'Tarea' },
      date: { value: '2026-10-06' },
      status: 'NEEDS_REVIEW',
    });
    expect(subjectOf(r.proposals[0]!)).toBe('Programación');
    expect(r.proposals[0]!.time.alternatives).toEqual(['16:00', '04:00']);
  });

  it('a Monday-afternoon "martes" that has already passed its hour still moves to next week, with the warning', () => {
    const at = new Date('2026-10-06T20:00:00.000Z'); // Tuesday 3 pm
    const [p] = run('Tarea de programación martes 10am', SUBJECTS, 'QUICK', at).proposals;
    expect(p!.date.value).toBe('2026-10-13');
    expect(p!.warnings.map((w) => w.code)).toContain('MOVED_TO_NEXT_WEEK');
  });
});

describe('Quick Capture and the Inbox read with the same engine', () => {
  const MESSAGE =
    'Buenas tardes estudiantes. El martes a las 10 am tendremos parcial de redes y quiz de bases. Entregar informe de programación el viernes.';

  it('a pasted message gives the same activities the inbox always gave', () => {
    const legacy = parseAcademicInbox(MESSAGE, ctx());
    const r = run(MESSAGE, SUBJECTS, 'INBOX');
    expect(r.proposals).toHaveLength(legacy.proposals.length);
    expect(
      r.proposals.map((p) => ({
        title: p.title.value,
        type: p.type.value,
        date: p.date.value,
        time: p.time.value,
        subject: p.subject.kind === 'EXISTING' ? p.subject.id : null,
      })),
    ).toEqual(
      legacy.proposals.map((p) => ({
        title: p.title,
        type: p.type,
        date: p.dueDate,
        time: p.dueTime,
        subject: p.subjectId,
      })),
    );
  });

  it('what the sentence says once is inherited, and says so (origin)', () => {
    const r = run(MESSAGE, SUBJECTS, 'INBOX');
    const quiz = r.proposals.find((p) => p.type.value === 'QUIZ')!;
    expect(quiz.date).toMatchObject({ value: '2026-10-06', origin: 'INHERITED' });
    expect(quiz.time).toMatchObject({ value: '10:00', origin: 'INHERITED' });
  });

  it('a message with nothing to do yields none, and says so', () => {
    const r = run('Buenas tardes estudiantes. Gracias por su atención.', SUBJECTS, 'INBOX');
    expect(r.proposals).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['NO_ACTIVITIES']);
  });

  it('the quick phrase still never needs an activity word to produce a proposal', () => {
    expect(run('asdf xyz', SUBJECTS).proposals).toHaveLength(1);
    expect(run('asdf xyz', SUBJECTS, 'INBOX').proposals).toEqual([]);
  });
});

describe('contract', () => {
  const TEXTS = [
    'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
    'Ciberseguridad todos los martes y jueves',
    'Parcial de ciberseguridad martes',
    'Parcial martes, exposición jueves y reunión de semillero viernes',
    'lunes y martes a las 7, jueves a las 4 y viernes a las 6',
    'asdf',
  ];

  it('every result is valid against the shared schema, with unique ids and the right selection', () => {
    for (const text of TEXTS) {
      const r = run(text, [REDES, PROG, CIBER]);
      expect(() => captureResultSchema.parse(r), text).not.toThrow();
      expect(new Set(r.proposals.map((p) => p.clientId)).size).toBe(r.proposals.length);
      for (const p of r.proposals) {
        expect(p.selected, `${text} ${p.clientId}`).toBe(p.status === 'READY');
        // READY means nothing blocks; anything else has a reason.
        expect(p.status === 'READY', `${text} ${p.clientId}`).toBe(p.blockingIssues.length === 0);
      }
    }
  });

  it('is deterministic: the same text gives the same proposals', () => {
    for (const text of TEXTS) expect(run(text)).toEqual(run(text));
  });

  it('the request is strict: the text and the mode, nothing else (no period, no user)', () => {
    expect(captureRequestSchema.parse({ text: 'x' })).toEqual({ text: 'x', mode: 'QUICK' });
    expect(captureRequestSchema.safeParse({ text: 'x', periodId: id(1) }).success).toBe(false);
    expect(captureRequestSchema.safeParse({ text: 'x', mode: 'OTHER' }).success).toBe(false);
  });

  it('nothing invents what the text does not say: no date, time or subject out of thin air', () => {
    const [p] = run('Taller de redes', SUBJECTS).proposals;
    expect(p!.date.value).toBeNull();
    expect(p!.time).toMatchObject({ value: null, hasTime: false, certainty: 'MISSING' });
    const [q] = run('Taller martes', SUBJECTS).proposals;
    expect(q!.subject).toMatchObject({ kind: 'UNRESOLVED' });
  });

  it('computeCorrections only lists a question that several proposals share', () => {
    const r = run('Taller lunes y martes a las 6', [REDES]);
    expect(computeCorrections(r.proposals).map((c) => [c.field, c.clientIds])).toEqual([
      ['subject', ['p1', 'p2']],
      ['time', ['p1', 'p2']],
    ]);
  });
});

describe('what the student already has', () => {
  const existing = (over: object = {}) => ({
    id: id(90),
    title: 'Parcial',
    type: 'EXAM' as const,
    subjectId: REDES.id,
    dueAt: new Date('2026-10-06T15:00:00.000Z'),
    ...over,
  });

  it('flags the same subject, day, type and related title, unticks it and never blocks it', () => {
    const r = run('Parcial de redes martes');
    const [p] = markExistingDuplicates(r.proposals, [existing()], 'America/Bogota');
    expect(p!.duplicateOf).toEqual({ id: id(90), title: 'Parcial' });
    expect(p!.selected).toBe(false);
    expect(p!.status).toBe('READY');
    expect(p!.warnings.map((w) => w.code)).toContain('POSSIBLE_DUPLICATE');
  });

  it("a general activity is compared with the general ones, not with the subjects'", () => {
    const r = run('Reunión de semillero martes', []);
    const same = markExistingDuplicates(
      r.proposals,
      [existing({ title: 'Reunión de semillero', type: 'OTHER', subjectId: null })],
      'America/Bogota',
    );
    expect(same[0]!.duplicateOf).not.toBeNull();
    const other = markExistingDuplicates(
      r.proposals,
      [existing({ title: 'Reunión de semillero', type: 'OTHER', subjectId: REDES.id })],
      'America/Bogota',
    );
    expect(other[0]!.duplicateOf).toBeNull();
  });

  it('a proposal whose subject is not decided is not compared (nothing to compare by)', () => {
    const r = run('Parcial martes', [REDES, PROG]);
    expect(
      markExistingDuplicates(r.proposals, [existing()], 'America/Bogota')[0]!.duplicateOf,
    ).toBeNull();
  });
});
