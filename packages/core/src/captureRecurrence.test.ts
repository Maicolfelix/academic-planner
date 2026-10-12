import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_BLOCKS, parseCaptureProposals } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';

// "Today" is Monday 12 October 2026, 15:00 in Bogotá.
const NOW = new Date('2026-10-12T20:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SUBJECTS = [
  { id: id(1), name: 'Ciberseguridad' },
  { id: id(2), name: 'Redes de Computadores' },
  { id: id(3), name: 'Fisiología' },
];
const ctx = (subjects = SUBJECTS): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects,
  period: { startDate: '2026-08-03', endDate: '2026-11-28' },
});
const parse = (text: string, subjects = SUBJECTS) =>
  parseCaptureProposals(text, ctx(subjects), 'QUICK');

/** The weekly schedule: the weekdays with their two times, in a form that is easy to compare. */
const slots = (text: string, subjects = SUBJECTS) =>
  parse(text, subjects).suggestions.map((s) =>
    s.slots.map((x) => [x.weekday, x.time.value, x.endTime.value] as const),
  );

describe('recurrence: what repeats every week becomes a weekly schedule', () => {
  it('"todos los martes": one weekday', () => {
    expect(slots('Tengo Ciberseguridad todos los martes de 6 pm a 8 pm')).toEqual([
      [[2, '18:00', '20:00']],
    ]);
  });

  it('"todos los martes y jueves": two weekdays in ONE schedule of one subject', () => {
    const r = parse('Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm');
    expect(r.proposals).toEqual([]);
    expect(r.suggestions).toHaveLength(1);
    const [s] = r.suggestions;
    expect(s).toMatchObject({
      kind: 'WEEKLY_SCHEDULE',
      status: 'READY',
      blockType: 'CLASS',
      subject: { kind: 'EXISTING', name: 'Ciberseguridad' },
      title: { value: 'Ciberseguridad' },
      blockingIssues: [],
      missing: [],
    });
    expect(s!.slots.map((x) => [x.weekday, x.time.value, x.endTime.value])).toEqual([
      [2, '18:00', '20:00'],
      [4, '18:00', '20:00'],
    ]);
  });

  it('"cada lunes", "semanalmente" and "todas las semanas" are also strong evidence', () => {
    expect(slots('Cada lunes tengo Redes de 7 a 9')).toEqual([[[1, '07:00', '09:00']]]);
    expect(slots('Veo Redes semanalmente los lunes de 7 a 9')).toEqual([[[1, '07:00', '09:00']]]);
    expect(slots('Fisiología todas las semanas martes y jueves de 8 a 10')).toEqual([
      [
        [2, '08:00', '10:00'],
        [4, '08:00', '10:00'],
      ],
    ]);
  });

  it('different hours for different weekdays of the same subject', () => {
    expect(
      slots('Tengo clase de fisiología los lunes y miércoles de 7 a 9 y los viernes de 8 a 10'),
    ).toEqual([
      [
        [1, '07:00', '09:00'],
        [3, '07:00', '09:00'],
        [5, '08:00', '10:00'],
      ],
    ]);
  });

  it('two subjects in one sentence stay two schedules, never mixed', () => {
    const r = parse('Tengo fisiología todos los lunes de 7 a 9 y redes todos los jueves de 2 a 4');
    expect(r.suggestions.map((s) => s.subject.kind === 'EXISTING' && s.subject.name)).toEqual([
      'Fisiología',
      'Redes de Computadores',
    ]);
    expect(
      r.suggestions.map((s) => s.slots.map((x) => [x.weekday, x.time.value, x.endTime.value])),
    ).toEqual([[[1, '07:00', '09:00']], [[4, '14:00', '16:00']]]);
  });

  it('references: "la del martes es de 8 a 10 y la del jueves de 2 a 4"', () => {
    const r = parse(
      'Tengo clases martes y jueves; la del martes es de 8 a 10 y la del jueves de 2 a 4',
    );
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.slots.map((x) => [x.weekday, x.time.value, x.endTime.value])).toEqual([
      [2, '08:00', '10:00'],
      [4, '14:00', '16:00'],
    ]);
    // the only thing missing is the subject, and it is the only thing asked
    expect(r.suggestions[0]!.missing).toEqual(['subject']);
  });

  it('a study session is a STUDY block', () => {
    const [s] = parse(
      'Tengo sesión de estudio de redes todos los miércoles de 4 a 6 pm',
    ).suggestions;
    expect(s).toMatchObject({ kind: 'WEEKLY_SCHEDULE', blockType: 'STUDY' });
    expect(s!.slots[0]).toMatchObject({ weekday: 3 });
  });

  it('noise, capitals and punctuation do not change the reading', () => {
    const clean = slots('Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm');
    expect(
      slots('Tengo   Ciberseguridad,,, todos los MARTES... y jueves!!! de 6 pm a 8 pm???'),
    ).toEqual(clean);
  });
});

describe('recurrence: the end time is never invented', () => {
  it('a lone start asks "¿Hasta qué hora?" ONCE, however many weekdays', () => {
    const r = parse('Tengo Redes todos los lunes y miércoles a las 7 am');
    const [s] = r.suggestions;
    expect(s).toMatchObject({ status: 'NEEDS_REVIEW', selected: false, missing: ['endTime'] });
    expect(s!.blockingIssues.filter((b) => b.code === 'END_TIME_MISSING')).toHaveLength(1);
    expect(s!.slots.map((x) => [x.time.value, x.endTime.value, x.endTime.certainty])).toEqual([
      ['07:00', null, 'MISSING'],
      ['07:00', null, 'MISSING'],
    ]);
  });

  it('an explicit range gives both ends; a bare range is read with class hours and is LIKELY, not EXACT', () => {
    const exact = parse('Tengo Ciberseguridad todos los martes de 6 pm a 8 pm').suggestions[0]!;
    expect(exact.slots[0]!.endTime.certainty).toBe('EXACT');
    const bare = parse('Tengo Ciberseguridad todos los martes de 6 a 8').suggestions[0]!;
    expect(bare.slots[0]).toMatchObject({
      time: { value: '18:00', certainty: 'LIKELY' },
      endTime: { value: '20:00', certainty: 'LIKELY' },
    });
    const morning = parse('Tengo Ciberseguridad todos los martes de 7 a 9').suggestions[0]!;
    expect(morning.slots[0]!.time.value).toBe('07:00');
    expect(morning.slots[0]!.endTime.value).toBe('09:00');
  });
});

describe('recurrence: the subject follows the same rules as an activity', () => {
  it('an exact name is attached; an unknown one is a question, never an invented subject', () => {
    expect(
      parse('Tengo Ciberseguridad todos los martes de 6 pm a 8 pm').suggestions[0]!.subject,
    ).toMatchObject({
      kind: 'EXISTING',
      id: id(1),
    });
    const unknown = parse('Tengo Mecánica Cuántica todos los lunes de 7 a 9').suggestions[0]!;
    expect(unknown.subject).toMatchObject({
      kind: 'UNRESOLVED',
      reason: 'UNKNOWN_NAME',
      suggestedName: 'Mecánica Cuántica',
    });
    expect(unknown).toMatchObject({ status: 'NEEDS_REVIEW', missing: ['subject'] });
    expect(unknown.blockingIssues.map((b) => b.code)).toEqual(['SUBJECT_UNKNOWN']);
  });
});

describe('recurrence: weak evidence is only a possibility', () => {
  it('"martes y jueves" alone stays activities that MAY be a weekly class', () => {
    for (const text of [
      'Ciberseguridad martes y jueves a las 6',
      'Ciberseguridad martes y jueves de 6 a 8',
    ]) {
      const r = parse(text);
      expect(r.suggestions, text).toEqual([]);
      expect(r.proposals.length, text).toBe(2);
      expect(
        r.proposals.every((p) => p.possibleRecurrence),
        text,
      ).toBe(true);
    }
  });
});

describe('recurrence: a repeating ACTIVITY is understood but never turned into a class', () => {
  it('"un quiz todos los viernes" is unsupported: no block, no activities, nothing selected', () => {
    const r = parse('Tengo un quiz todos los viernes');
    expect(r.proposals).toEqual([]);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({
      kind: 'RECURRING_ACTIVITY_UNSUPPORTED',
      status: 'UNSUPPORTED',
      selected: false,
    });
    expect(r.suggestions[0]!.slots.map((x) => x.weekday)).toEqual([5]);
  });

  it('a task that repeats every day is also unsupported, with its seven weekdays', () => {
    const [s] = parse(
      'Tengo una tarea todos los lunes martes miércoles jueves viernes sábado domingo de 7 a 9',
    ).suggestions;
    expect(s!.kind).toBe('RECURRING_ACTIVITY_UNSUPPORTED');
    expect(s!.slots).toHaveLength(7);
  });
});

describe('recurrence: an activity and a schedule in the same text', () => {
  it('one activity and one weekly schedule come out together, each one its own', () => {
    const r = parse(
      'Tengo un parcial de redes el viernes a las 8 am y clase de ciberseguridad todos los martes y jueves de 6 pm a 8 pm',
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({
      type: { value: 'EXAM' },
      date: { value: '2026-10-16' },
      time: { value: '08:00' },
    });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.slots.map((x) => x.weekday)).toEqual([2, 4]);
  });
});

describe('recurrence: limits and determinism', () => {
  it('more weekly blocks than a normal text has is reported, never truncated in silence', () => {
    const group = (name: string) =>
      `Tengo ${name} todos los lunes martes miércoles jueves viernes sábado domingo de 7 a 9.`;
    const text = [
      group('fisiología'),
      group('redes'),
      group('ciberseguridad'),
      group('mecánica'),
    ].join(' ');
    const r = parse(text);
    expect(CAPTURE_MAX_BLOCKS).toBe(21);
    expect(r.status).toBe('TOO_MANY_PROPOSALS');
    expect(r.suggestions).toEqual([]);
  });

  it('the same text and the same moment give the same answer', () => {
    const text =
      'Tengo un parcial de redes el viernes a las 8 am y clase de ciberseguridad todos los martes y jueves de 6 pm a 8 pm';
    expect(JSON.stringify(parse(text))).toBe(JSON.stringify(parse(text)));
  });
});
