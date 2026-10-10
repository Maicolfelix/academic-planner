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

const subjectOf = (p: CaptureProposal) =>
  p.subject.kind === 'EXISTING' ? p.subject.name : p.subject.kind;
const blocking = (p: CaptureProposal) => p.blockingIssues.map((b) => b.code);
/** Day, hour and status of each proposal: the structure that matters, as plain data. */
const rows = (r: CaptureResult) =>
  r.proposals.map((p) => [p.date.value, p.time.value, p.status] as const);

describe('the critical example: four days, two hours by position, no friction', () => {
  const TEXT =
    'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM';

  it('is EXACTLY four READY proposals: Ensayo, each day, each hour, no subject, selected, nothing blocking', () => {
    const r = run(TEXT); // the student HAS subjects and did not mention one: nothing to ask
    expect(r.status).toBe('OK');
    expect(r.suggestions).toEqual([]);
    expect(r.proposals).toHaveLength(4);
    const ready = { subject: 'NONE', status: 'READY', selected: true, blockingIssues: [] };
    expect(
      r.proposals.map((p) => ({
        title: p.title.value,
        date: p.date.value,
        time: p.time.value,
        subject: p.subject.kind,
        status: p.status,
        selected: p.selected,
        blockingIssues: p.blockingIssues,
      })),
    ).toEqual([
      { title: 'Ensayo', date: '2026-10-12', time: '07:30', ...ready }, // lunes
      { title: 'Ensayo', date: '2026-10-13', time: '07:30', ...ready }, // martes
      { title: 'Ensayo', date: '2026-10-15', time: '17:40', ...ready }, // jueves
      { title: 'Ensayo', date: '2026-10-16', time: '17:40', ...ready }, // viernes
    ]);
    expect(r.corrections).toEqual([]); // nothing to correct: straight to "Crear 4 actividades"
  });

  it('is the same with no subjects at all (it is not a special case), and on a Saturday', () => {
    for (const result of [run(TEXT, []), run(TEXT, SUBJECTS, 'QUICK', SATURDAY)]) {
      expect(rows(result)).toEqual([
        ['2026-10-12', '07:30', 'READY'],
        ['2026-10-13', '07:30', 'READY'],
        ['2026-10-15', '17:40', 'READY'],
        ['2026-10-16', '17:40', 'READY'],
      ]);
      expect(result.proposals.every((p) => p.subject.kind === 'NONE')).toBe(true);
    }
    expect(
      run(TEXT, SUBJECTS, 'QUICK', SATURDAY).proposals.flatMap((p) =>
        p.warnings.map((w) => w.code),
      ),
    ).not.toContain('MOVED_TO_NEXT_WEEK');
  });

  it('shares ONE group and keeps each time with its days (the temporal model)', () => {
    const r = run(TEXT);
    expect(new Set(r.proposals.map((p) => p.groupId))).toEqual(new Set(['g1']));
    expect(r.proposals.map((p) => p.time.groupKey)).toEqual(['g1:t0', 'g1:t0', 'g1:t1', 'g1:t1']);
    expect(r.proposals.every((p) => p.time.certainty === 'EXACT' && p.time.hasTime)).toBe(true);
  });

  it('naming a subject changes nothing about being READY', () => {
    const r = run(
      'Ensayo de redes el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM',
    );
    expect(r.proposals).toHaveLength(4);
    expect(r.proposals.every((p) => p.status === 'READY' && p.selected)).toBe(true);
    expect(r.proposals.every((p) => subjectOf(p) === REDES.name)).toBe(true);
  });
});

describe('the subject: not mentioned is NOT unresolved', () => {
  it('"Ensayo lunes": READY, no subject, nothing to ask (the student does have subjects)', () => {
    const r = run('Ensayo lunes');
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({
      title: { value: 'Ensayo' },
      date: { value: '2026-10-05' },
      subject: { kind: 'NONE', reason: 'NOT_MENTIONED' },
      status: 'READY',
      selected: true,
      blockingIssues: [],
    });
  });

  it('"Ensayo lunes y martes": two READY proposals, no subject', () => {
    const r = run('Ensayo lunes y martes');
    expect(rows(r)).toEqual([
      ['2026-10-05', null, 'READY'],
      ['2026-10-06', null, 'READY'],
    ]);
    expect(r.proposals.every((p) => p.subject.kind === 'NONE')).toBe(true);
  });

  it('a student with no subjects at all gets the very same thing (no special case)', () => {
    const [p] = run('Llevar documentos el viernes', []).proposals;
    expect(p!.subject.kind).toBe('NONE');
    expect(p).toMatchObject({ status: 'READY', selected: true });
  });

  it('a subject that is named is applied, with no question', () => {
    const [p] = run('Parcial de redes martes').proposals;
    expect(p!.subject).toMatchObject({ kind: 'EXISTING', id: REDES.id });
    expect(p!.status).toBe('READY');
    const [q] = run('Tarea de programación viernes').proposals;
    expect(q!.subject).toMatchObject({ kind: 'EXISTING', id: PROG.id, certainty: 'EXACT' });
  });

  it('a subject that is named but does not exist asks: the proposal exists, says so and offers the name', () => {
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
    expect(p!.selected).toBe(false);
  });

  it('a name is only taken for a subject after "de": "parcial unidad 3", "parcial final", "parcial de unidad 3" are plain titles', () => {
    for (const [text, title] of [
      ['Parcial unidad 3 martes', 'Parcial unidad 3'],
      ['Parcial final martes', 'Parcial final'],
      ['Parcial de unidad 3 martes', 'Parcial unidad 3'],
    ] as const) {
      const [p] = run(text, [REDES, PROG]).proposals;
      expect(p!.subject, text).toMatchObject({ kind: 'NONE', reason: 'NOT_MENTIONED' });
      expect(p!.title.value, text).toBe(title);
      expect(p!.status, text).toBe('READY');
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
    expect(p!.status).toBe('NEEDS_REVIEW');
  });

  it('proposals that share the same unresolved subject share ONE correction; a lone one has none', () => {
    const two = run('Parcial de ciberseguridad martes y tarea de ciberseguridad jueves', [
      REDES,
      PROG,
    ]);
    expect(two.corrections).toEqual([
      expect.objectContaining({
        field: 'subject',
        key: 'UNKNOWN:ciberseguridad',
        suggestedName: 'Ciberseguridad',
        clientIds: ['p1', 'p2'],
      }),
    ]);
    expect(run('Parcial de ciberseguridad martes', [REDES, PROG]).corrections).toEqual([]);
  });
});

describe('hours: only what the words settle is settled', () => {
  const only = (text: string, subjects = SUBJECTS) => run(text, subjects).proposals[0]!;

  it('an hour with no am/pm is AMBIGUOUS with both readings, a. m. first; never 06:00', () => {
    for (const [text, alternatives] of [
      ['Ensayo lunes a las 6', ['06:00', '18:00']],
      ['Ensayo lunes a las 10', ['10:00', '22:00']],
      ['Ensayo lunes a las 7:30', ['07:30', '19:30']],
      ['Ensayo lunes 7:30', ['07:30', '19:30']],
      ['Ensayo lunes a las 12', ['00:00', '12:00']],
    ] as const) {
      const p = only(text);
      expect(p.time, text).toMatchObject({
        value: null,
        hasTime: false,
        certainty: 'AMBIGUOUS',
        alternatives,
      });
      expect(blocking(p), text).toEqual(['TIME_AMBIGUOUS']);
      expect(p.status, text).toBe('NEEDS_REVIEW');
      // ... and the ambiguity is the ONLY reason: the subject is not a question.
      expect(p.subject.kind, text).toBe('NONE');
    }
  });

  it('what is explicit is READY: 7:30 am/pm, 24 hours, "a las 14", and am/pm said in words', () => {
    for (const [text, time] of [
      ['Ensayo lunes a las 7:30 am', '07:30'],
      ['Ensayo lunes a las 7:30 pm', '19:30'],
      ['Ensayo lunes 19:30', '19:30'],
      ['Ensayo lunes a las 14', '14:00'],
      ['Ensayo lunes a las 18', '18:00'],
      ['Ensayo lunes a las 6 pm', '18:00'],
      ['Ensayo lunes a las 7:30 de la mañana', '07:30'],
      ['Ensayo lunes a las 7:30 de la noche', '19:30'],
      ['Ensayo lunes a las 3 de la tarde', '15:00'],
      ['Ensayo lunes a las 12 de la noche', '00:00'],
      ['Ensayo lunes a las 12 de la tarde', '12:00'],
    ] as const) {
      const p = only(text);
      expect(p.time.value, text).toBe(time);
      expect(p.time.certainty, text).not.toBe('AMBIGUOUS');
      expect(p.status, text).toBe('READY');
    }
  });

  it('words that do not settle it leave it a question, and "mañana" in them is not tomorrow', () => {
    const r = run('Ensayo lunes a las 12 de la mañana');
    expect(r.proposals).toHaveLength(1); // no phantom proposal for "tomorrow"
    expect(r.proposals[0]!.time).toMatchObject({
      certainty: 'AMBIGUOUS',
      alternatives: ['00:00', '12:00'],
    });
    expect(only('Ensayo lunes a las 1 de la noche').time.certainty).toBe('AMBIGUOUS');
    // The same word does mean tomorrow when it is not about an hour.
    expect(only('Ensayo mañana').date.value).toBe('2026-10-06');
  });

  it('three days sharing one ambiguous hour are three proposals and ONE correction', () => {
    const r = run('Ensayo lunes, martes y jueves a las 7:30');
    expect(r.proposals).toHaveLength(3);
    expect(r.proposals.map(blocking)).toEqual(Array(3).fill(['TIME_AMBIGUOUS']));
    expect(r.corrections).toEqual([
      expect.objectContaining({
        field: 'time',
        key: 'g1:t0',
        clientIds: ['p1', 'p2', 'p3'],
        alternatives: ['07:30', '19:30'],
      }),
    ]);
  });

  it('with the meridiem the same text is three READY proposals and no correction', () => {
    const r = run('Ensayo lunes, martes y jueves a las 7:30 am');
    expect(r.proposals.map((p) => [p.time.value, p.status])).toEqual(
      Array(3).fill(['07:30', 'READY']),
    );
    expect(r.corrections).toEqual([]);
  });
});

describe('days and hours', () => {
  it('a time written after each run of days belongs to that run ("lunes y martes a las 7, jueves a las 4 y viernes a las 6")', () => {
    const r = run('Taller de redes lunes y martes a las 7, jueves a las 4 y viernes a las 6');
    expect(r.proposals.map((p) => [p.date.value, p.time.alternatives])).toEqual([
      ['2026-10-05', ['07:00', '19:00']],
      ['2026-10-06', ['07:00', '19:00']],
      ['2026-10-08', ['04:00', '16:00']],
      ['2026-10-09', ['06:00', '18:00']],
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

  it('a shared time: "lunes, miércoles y viernes a las 8 am" (a morning hour already past today is next week\'s)', () => {
    expect(rows(run('Taller de redes lunes, miércoles y viernes a las 8 am'))).toEqual([
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
    expect(rows(run('Taller de redes lunes a viernes a las 8 am'))).toEqual(week);
    expect(rows(run('Taller de redes de lunes a viernes a las 8am'))).toEqual(week);
    expect(run('Taller de redes lunes a viernes a las 8 am').proposals[0]!.title.value).toBe(
      'Taller',
    );
  });

  it('"respectivamente": the hours go to the days in order', () => {
    expect(rows(run('Taller de redes lunes y jueves a las 8 am y 10 am respectivamente'))).toEqual([
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
    const expected = [
      ['2026-10-12', '07:00', 'READY'],
      ['2026-10-13', '17:00', 'READY'],
      ['2026-10-15', '17:00', 'READY'],
    ];
    expect(
      rows(
        run(
          'Taller de redes lunes, martes y jueves, los dos últimos a las 5pm y el primero a las 7am',
        ),
      ),
    ).toEqual(expected);
    expect(
      rows(
        run('Taller de redes lunes, martes y jueves, el primero a las 7am y el resto a las 5pm'),
      ),
    ).toEqual(expected);
  });

  it('a group that cannot be distributed only marks the days it affects', () => {
    const r = run(
      'Taller de redes lunes, martes, jueves y viernes, los dos primeros a las 7am y los otros tres a las 5pm',
    );
    expect(rows(r)).toEqual([
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
});

describe('several activities, one text', () => {
  it('"parcial martes y exposición jueves": two activities, each with its own title and type', () => {
    const r = run('Parcial martes y exposición jueves');
    expect(
      r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.time.value, p.status]),
    ).toEqual([
      ['Parcial', 'EXAM', '2026-10-06', null, 'READY'],
      ['Exposición', 'PRESENTATION', '2026-10-08', null, 'READY'],
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

  it('"entregar informe lunes, exposición martes y reunión viernes": three activities (a meeting is one too)', () => {
    const r = run('entregar informe lunes, exposición martes y reunión viernes');
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.status])).toEqual([
      ['Entregar informe', 'TASK', '2026-10-05', 'READY'],
      ['Exposición', 'PRESENTATION', '2026-10-06', 'READY'],
      ['Reunión', 'OTHER', '2026-10-09', 'READY'],
    ]);
  });

  it('"parcial martes, exposición jueves y reunión de semillero viernes": three READY, the third not swallowed', () => {
    const r = run('Parcial martes, exposición jueves y reunión de semillero viernes');
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.status])).toEqual([
      ['Parcial', 'EXAM', '2026-10-06', 'READY'],
      ['Exposición', 'PRESENTATION', '2026-10-08', 'READY'],
      ['Reunión de semillero', 'OTHER', '2026-10-09', 'READY'],
    ]);
    expect(r.proposals.every((p) => p.subject.kind === 'NONE')).toBe(true);
    expect(r.corrections).toEqual([]);
  });

  it('an activity with no activity word before another one is its own: "ensayo lunes y reunión martes"', () => {
    const r = run('Ensayo lunes y reunión martes');
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.groupId])).toEqual([
      ['Ensayo', 'TASK', '2026-10-05', 'g1'],
      ['Reunión', 'OTHER', '2026-10-06', 'g2'],
    ]);
    const withSubject = run('Ciberseguridad martes y reunión jueves');
    expect(withSubject.proposals.map((p) => [p.title.value, subjectOf(p), p.date.value])).toEqual([
      ['Ciberseguridad', 'Ciberseguridad', '2026-10-06'],
      ['Reunión', 'NONE', '2026-10-08'],
    ]);
  });

  it('but what a sentence says once is still shared: "el martes a las 10 am tendremos parcial y quiz"', () => {
    const r = run('El martes a las 10 am tendremos parcial y quiz');
    expect(r.proposals.map((p) => [p.type.value, p.date.value, p.time.value])).toEqual([
      ['EXAM', '2026-10-06', '10:00'],
      ['QUIZ', '2026-10-06', '10:00'],
    ]);
  });

  it('the same title on several days is inherited: "ensayo lunes, martes y jueves" is three of one group', () => {
    const r = run('Ensayo lunes, martes y jueves');
    expect(r.proposals.map((p) => [p.title.value, p.date.value, p.groupId, p.status])).toEqual([
      ['Ensayo', '2026-10-05', 'g1', 'READY'],
      ['Ensayo', '2026-10-06', 'g1', 'READY'],
      ['Ensayo', '2026-10-08', 'g1', 'READY'],
    ]);
  });

  it('"parcial martes y jueves": one activity on two days', () => {
    const r = run('parcial martes y jueves');
    expect(r.proposals.map((p) => [p.title.value, p.type.value, p.date.value, p.status])).toEqual([
      ['Parcial', 'EXAM', '2026-10-06', 'READY'],
      ['Parcial', 'EXAM', '2026-10-08', 'READY'],
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

  it('only a subject that was named and cannot be resolved is missing from a suggestion', () => {
    const [none] = run('Todos los martes y jueves a las 8 am', [REDES]).suggestions;
    expect(none!.subject.kind).toBe('NONE');
    expect(none!.missing).not.toContain('subject');
    const [unknown] = run('Parcial de ciberseguridad todos los martes', [REDES]).suggestions;
    expect(unknown!.missing).toContain('subject');
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
    const r = run(eleven.replace(', quiz sábado', ''), []);
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
    const [p] = run('Taller de redes 31/02').proposals;
    expect(p!.status).toBe('INVALID');
    expect(blocking(p!)).toContain('DATE_INVALID');
    expect(p!.blockingIssues.find((b) => b.code === 'DATE_INVALID')!.message).toContain('31/02');
  });

  it('a date with no day is NEEDS_REVIEW (something to say), not an error', () => {
    const [p] = run('Taller de redes').proposals;
    expect(blocking(p!)).toEqual(['DATE_MISSING']);
    expect(p!.status).toBe('NEEDS_REVIEW');
  });

  it('informative warnings never block: a past date is READY with a warning', () => {
    const [p] = run('Taller de redes 01/09/2026').proposals;
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
    expect(r.proposals[0]!.time.alternatives).toEqual(['04:00', '16:00']);
    expect(blocking(r.proposals[0]!)).toEqual(['TIME_AMBIGUOUS']);
  });

  it('a Tuesday-afternoon "martes 10am" that has already passed its hour still moves to next week, with the warning', () => {
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
    'Ensayo lunes a las 7:30',
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

  it('nothing invents what the text does not say: no date, no time, and no subject (it is NONE, not a guess)', () => {
    const [p] = run('Taller de redes').proposals;
    expect(p!.date.value).toBeNull();
    expect(p!.time).toMatchObject({ value: null, hasTime: false, certainty: 'MISSING' });
    const [q] = run('Taller martes').proposals;
    expect(q!.subject).toMatchObject({ kind: 'NONE', certainty: 'MISSING', origin: 'DEFAULT' });
  });

  it('computeCorrections only lists a question that several proposals share', () => {
    const r = run('Taller lunes y martes a las 6', [REDES]);
    expect(computeCorrections(r.proposals).map((c) => [c.field, c.clientIds])).toEqual([
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
    const r = run('Reunión de semillero martes');
    const general = existing({ title: 'Reunión de semillero', type: 'OTHER', subjectId: null });
    expect(
      markExistingDuplicates(r.proposals, [general], 'America/Bogota')[0]!.duplicateOf,
    ).not.toBeNull();
    const bound = existing({ title: 'Reunión de semillero', type: 'OTHER', subjectId: REDES.id });
    expect(
      markExistingDuplicates(r.proposals, [bound], 'America/Bogota')[0]!.duplicateOf,
    ).toBeNull();
  });

  it('a proposal whose subject is unresolved is not compared (nothing to compare by)', () => {
    const r = run('Parcial de ciberseguridad martes', [REDES, PROG]);
    expect(
      markExistingDuplicates(r.proposals, [existing()], 'America/Bogota')[0]!.duplicateOf,
    ).toBeNull();
  });
});
