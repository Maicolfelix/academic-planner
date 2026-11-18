import { describe, expect, it } from 'vitest';
import { parseCaptureProposals } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';

/**
 * "5 tareas empezando el lunes, una por día": N activities that go one on each day (QA report: five identical cards on the
 * same Monday plus a sixth "Tarea" with no date). Today is Wednesday 18 November 2026.
 */
const ctx = (): QuickCaptureContext => ({
  now: new Date('2026-11-18T20:00:00.000Z'),
  timeZone: 'America/Bogota',
  subjects: [],
  period: { startDate: '2026-08-03', endDate: '2026-12-28' },
});
const rows = (text: string) =>
  parseCaptureProposals(text, ctx(), 'QUICK').proposals.map(
    (p) => `${p.title.value}|${p.date.value ?? '-'}`,
  );
const MON_FRI = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];

describe('N activities, one per day', () => {
  it('the QA text: five tasks from Monday, one per day, no stray sixth card', () => {
    expect(
      rows(
        'Tengo 5 tareas sobre redes repartidas en la semana que viene empezando desde el lunes, una tarea por dia',
      ),
    ).toEqual(MON_FRI.map((d) => `Tarea sobre redes|${d}`));
  });

  it.each([
    'Tengo 5 tareas empezando el lunes, una por día',
    'Tengo 5 tareas desde el lunes, una cada día',
    'tengo 5 tareas empezando el lunes uno por dia',
    'Tengo 5 tareas el lunes en adelante, cada día una',
    'Tengo 5 tareas la semana que viene, una por día',
    'Tengo 5 tareas la próxima semana, una cada día',
    'tengo 5 tareas la semana siguiente, una tarea por dia',
  ])('%s', (text) => {
    expect(rows(text)).toEqual(MON_FRI.map((d) => `Tarea|${d}`));
  });

  it('works for any kind of activity and any count that fits the week', () => {
    expect(rows('Tengo 3 quices empezando el lunes, uno por día')).toEqual([
      'Quiz|2026-11-23',
      'Quiz|2026-11-24',
      'Quiz|2026-11-25',
    ]);
    expect(rows('Tengo 2 talleres empezando el martes, uno por día')).toEqual([
      'Taller|2026-11-24',
      'Taller|2026-11-25',
    ]);
  });

  it('does not make up weekend days: what does not fit is asked, not dated', () => {
    const found = parseCaptureProposals(
      'Tengo 4 tareas empezando el jueves, una por día',
      ctx(),
      'QUICK',
    ).proposals;
    expect(found).toHaveLength(4);
    expect(found.map((p) => p.date.value ?? '-')).toEqual(['2026-11-19', '2026-11-20', '-', '-']);
  });

  it('without the "one per day" words nothing changes: N on the same day', () => {
    expect(rows('Tengo 3 tareas para el lunes')).toEqual(Array(3).fill('Tarea|2026-11-23'));
  });

  it('a single activity "por día" is not spread', () => {
    expect(rows('Tengo una tarea el lunes')).toEqual(['Tarea|2026-11-23']);
  });
});

// ── generated texts with a known answer ─────────────────────────────────────────────────────────────────────────────────
const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const TYPES = [
  ['tareas', 'TASK'],
  ['quices', 'QUIZ'],
  ['talleres', 'WORKSHOP'],
  ['parciales', 'EXAM'],
  ['exposiciones', 'PRESENTATION'],
  ['proyectos', 'PROJECT'],
  ['lecturas', 'READING'],
] as const;
const DAYS = ['lunes', 'martes', 'jueves', 'viernes'] as const; // never Wednesday: today, "este miércoles" is ambiguous on purpose
const DATE_OF: Record<string, string> = {
  lunes: '2026-11-23',
  martes: '2026-11-24',
  miércoles: '2026-11-25',
  jueves: '2026-11-19',
  viernes: '2026-11-20',
};
const NEXT_WEEK_DATE: Record<string, string> = {
  lunes: '2026-11-23',
  martes: '2026-11-24',
  miércoles: '2026-11-25',
  jueves: '2026-11-26',
  viernes: '2026-11-27',
};
const WEEKDAY_ORDER = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes'];
const NOISE =
  /empezando|desde|semana|pr[oó]xima|siguiente|por d[ií]a|cada|repartid|adelante|partir/i;

describe('generated: N activities, one per day, from a day or from next week', () => {
  const run = (seed: number, total: number, step: 1 | 2) => {
    const r = lcg(seed);
    const bad: string[] = [];
    for (let n = 0; n < total; n++) {
      const [plural, type] = pick(r, TYPES);
      const count = 2 + Math.floor(r() * 4); // 2..5
      const fromWeek = r() < 0.4;
      const startDay = fromWeek ? 'lunes' : pick(r, DAYS);
      const start = fromWeek ? '2026-11-23' : DATE_OF[startDay]!;
      const frame = fromWeek
        ? pick(r, ['la semana que viene', 'la próxima semana', 'la semana siguiente'])
        : pick(r, [
            `empezando el ${startDay}`,
            `empezando desde el ${startDay}`,
            `desde el ${startDay}`,
            `a partir del ${startDay}`,
            `comenzando el ${startDay}`,
          ]);
      const cue =
        step === 2
          ? pick(r, ['uno cada dos días', 'una cada dos días', 'uno por medio, cada dos días'])
          : pick(r, ['una por día', 'uno por día', 'una cada día', 'uno cada día', 'cada día una']);
      const head = pick(r, ['Tengo', 'tengo', 'Me dejaron', 'Esta semana me pusieron']);
      const text = `${head} ${count} ${plural} ${frame}, ${cue}`;
      // expected: consecutive school days (every `step` days) from `start`, stopping at the weekend; the rest is asked
      const want: string[] = [];
      const base = Date.parse(`${start}T00:00:00Z`);
      for (let k = 0; k < count; k++) {
        const d = new Date(base + k * step * 86_400_000);
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) break;
        want.push(d.toISOString().slice(0, 10));
      }
      while (want.length < count) want.push('-');
      const got = parseCaptureProposals(text, ctx(), 'QUICK').proposals;
      const dates = got.map((p) => p.date.value ?? '-');
      const types = got.map((p) => p.type.value);
      const titles = got.map((p) => p.title.value);
      const ok =
        JSON.stringify(dates) === JSON.stringify(want) &&
        types.every((t) => t === type) &&
        !titles.some((t) => NOISE.test(t));
      if (!ok)
        bad.push(`${JSON.stringify(text)} → ${JSON.stringify({ dates, want, types, titles })}`);
    }
    return bad;
  };

  it.each([1, 2, 3])(
    '1500 texts, one per day, seed %i',
    (seed) => {
      expect(run(seed, 1500, 1)).toEqual([]);
    },
    60_000,
  );
  it('800 texts, every second day', () => {
    expect(run(9, 800, 2)).toEqual([]);
  }, 60_000);
});

describe('generated: a week said first puts every day of the sentence in that week', () => {
  it('1500 texts', () => {
    const r = lcg(21);
    const bad: string[] = [];
    const KINDS = [
      ['parcial', 'EXAM'],
      ['quiz', 'QUIZ'],
      ['taller', 'WORKSHOP'],
      ['tarea', 'TASK'],
      ['exposición', 'PRESENTATION'],
    ] as const;
    for (let n = 0; n < 1500; n++) {
      const items = 2 + Math.floor(r() * 3);
      const days = [...WEEKDAY_ORDER].sort(() => r() - 0.5).slice(0, items);
      const kinds = Array.from({ length: items }, () => pick(r, KINDS));
      const week = pick(r, ['La próxima semana', 'La semana que viene', 'La semana siguiente']);
      const verb = pick(r, ['tengo', 'entrego']);
      const parts = days.map((d, i) => `${kinds[i]![0]} el ${d}`);
      const text = `${week} ${verb} ${parts.slice(0, -1).join(', ')}${items > 1 ? ' y ' : ''}${parts.at(-1)}`;
      const got = parseCaptureProposals(text, ctx(), 'QUICK').proposals;
      const want = days.map((d, i) => `${kinds[i]![1]} ${NEXT_WEEK_DATE[d]}`);
      const have = got.map((p) => `${p.type.value} ${p.date.value ?? '-'}`);
      const titleNoise = got.some((p) => NOISE.test(p.title.value));
      if (JSON.stringify(have) !== JSON.stringify(want) || titleNoise)
        bad.push(`${JSON.stringify(text)} → ${JSON.stringify({ have, want })}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  }, 60_000);
});

describe('N activities spread over next week, with no "one per day"', () => {
  it.each([
    'Tengo 5 tareas repartidas en la próxima semana',
    'Tengo 5 tareas repartidas la semana que viene',
    'Me dejaron 5 talleres distribuidos en la semana siguiente',
    'Tengo 5 tareas de redes repartidas en la semana que viene',
  ])('five fill the five school days: %s', (text) => {
    const got = parseCaptureProposals(text, ctx(), 'QUICK').proposals;
    expect(got.map((p) => p.date.value)).toEqual(MON_FRI);
    expect(got.some((p) => /repartid|distribuid|semana|pr[oó]xima/i.test(p.title.value))).toBe(
      false,
    );
  });

  it.each([
    'Tengo 3 tareas repartidas en la próxima semana',
    'Tengo 6 tareas repartidas en la próxima semana',
    'Tengo 4 tareas repartidas la semana que viene',
  ])('any other count is asked, never guessed: %s', (text) => {
    const got = parseCaptureProposals(text, ctx(), 'QUICK').proposals;
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.every((p) => p.date.value === null)).toBe(true);
  });
});

describe('phrasings found by the hunt (each one was wrong, silently)', () => {
  const subjects = [
    { id: '00000000-0000-4000-8000-000000000001', name: 'Redes' },
    { id: '00000000-0000-4000-8000-000000000002', name: 'Cálculo' },
  ];
  const withSubjects = () => ({ ...ctx(), subjects });
  const read = (text: string) =>
    parseCaptureProposals(text, withSubjects(), 'QUICK').proposals.map(
      (p) =>
        `${p.type.value} ${p.date.value ?? '-'} ${p.subject.kind === 'EXISTING' ? p.subject.name : '-'}`,
    );

  it('"viernes 27" is Friday the 27th, not the next Friday', () => {
    const got = parseCaptureProposals(
      'taller de redes viernes 27 a las 2:30 pm',
      withSubjects(),
      'QUICK',
    ).proposals;
    expect(got.map((p) => `${p.date.value} ${p.time?.value}`)).toEqual(['2026-11-27 14:30']);
    expect(got[0]!.title.value).not.toMatch(/27/);
  });

  it('a count with no noun after "y" repeats the kind: "2 tareas el lunes y 1 el martes" are three', () => {
    expect(read('tengo 2 tareas el lunes y 1 el martes')).toEqual([
      'TASK 2026-11-23 -',
      'TASK 2026-11-23 -',
      'TASK 2026-11-24 -',
    ]);
    expect(read('tengo 1 quiz el lunes y 2 el jueves')).toEqual([
      'QUIZ 2026-11-23 -',
      'QUIZ 2026-11-19 -',
      'QUIZ 2026-11-19 -',
    ]);
  });

  it('"todos a las 8" shares an hour, it is not a weekly repetition', () => {
    const got = parseCaptureProposals(
      'tengo 3 quices, el lunes, el martes y el jueves, todos a las 8 am',
      ctx(),
      'QUICK',
    );
    expect(got.suggestions).toEqual([]);
    expect(got.proposals.map((p) => `${p.date.value} ${p.time?.value}`)).toEqual([
      '2026-11-23 08:00',
      '2026-11-24 08:00',
      '2026-11-26 08:00',
    ]);
  });

  it('"todos los lunes" and "todas las semanas" still repeat', () => {
    const got = parseCaptureProposals('quiz de redes todos los lunes a las 8 am', ctx(), 'QUICK');
    expect(got.proposals).toHaveLength(0);
    expect(got.suggestions).toHaveLength(1);
  });

  it('"uno de redes el jueves y otro de cálculo el viernes": each one keeps its own subject', () => {
    expect(read('tengo 2 parciales: uno de redes el jueves y otro de cálculo el viernes')).toEqual([
      'EXAM 2026-11-19 Redes',
      'EXAM 2026-11-20 Cálculo',
    ]);
  });

  it('a week said first puts both days in that week', () => {
    expect(
      read(
        'La próxima semana tengo parcial de redes el martes a las 8 am y taller de cálculo el jueves a las 2 pm',
      ),
    ).toEqual(['EXAM 2026-11-24 Redes', 'WORKSHOP 2026-11-26 Cálculo']);
  });

  it('"esta semana" is never part of a title', () => {
    const got = parseCaptureProposals(
      'Esta semana tengo parcial de redes el jueves',
      withSubjects(),
      'QUICK',
    ).proposals;
    expect(got[0]!.title.value).toBe('Parcial');
  });
});

describe('a title never ends on "sobre" once its subject is recognised', () => {
  it('"5 tareas sobre redes…" with the subject Redes gives "Tarea", not "Tarea sobre"', () => {
    const got = parseCaptureProposals(
      'Tengo 5 tareas sobre redes repartidas en la semana que viene, una por día',
      { ...ctx(), subjects: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Redes' }] },
      'QUICK',
    ).proposals;
    expect(got).toHaveLength(5);
    expect(got.every((p) => p.title.value === 'Tarea')).toBe(true);
  });
});
