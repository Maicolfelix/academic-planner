import { describe, expect, it } from 'vitest';
import { parseCaptureProposals } from './captureProposals.js';
import type { QuickCaptureContext } from './captureShared.js';
import { orderTimetable } from './captureTimetableOrder.js';

/**
 * A weekly timetable written with the HOURS FIRST ("Lunes 8-10 Redes, martes 10-12 Cálculo") or with a day heading over several
 * subjects ("Lunes: Redes 8-10, Cálculo 10-12") is the same timetable as "Redes lunes 8-10, Cálculo martes 10-12". "Today" is
 * Wednesday 18 November 2026, 15:00 in Bogotá. Seeded generators: a failure is reproducible, never flaky.
 */
const NOW = new Date('2026-11-18T20:00:00.000Z');
const SUBJECTS = ['Redes', 'Cálculo', 'Física', 'Programación Web', 'Bases de Datos', 'Inglés'];
const ctx = (): QuickCaptureContext => ({
  now: NOW,
  timeZone: 'America/Bogota',
  subjects: SUBJECTS.map((name, i) => ({
    id: `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`,
    name,
  })),
  period: { startDate: '2026-08-03', endDate: '2026-12-28' },
});
const read = (text: string) => parseCaptureProposals(text, ctx(), 'QUICK');
/** "Redes d1 08:00-10:00": subject, weekday (1 = lunes) and hours of every slot of every suggested class. */
const classes = (text: string) =>
  read(text).suggestions.flatMap((s) =>
    s.slots.map(
      (x) =>
        `${s.subject.kind === 'EXISTING' ? s.subject.name : '?'} d${x.weekday} ${x.time.value ?? '-'}-${x.endTime.value ?? '-'}`,
    ),
  );

describe('orderTimetable: the same words in the order the engine reads', () => {
  const subjects = SUBJECTS.map((name) => ({ name }));

  it('puts the subject first and keeps everything the student wrote', () => {
    expect(orderTimetable('Lunes 8-10 Redes, martes 10-12 Cálculo', subjects)).toBe(
      'Redes Lunes de 8-10, Cálculo martes de 10-12',
    );
    expect(orderTimetable('Lunes y miércoles de 8 a 10 am tengo Cálculo', subjects)).toBe(
      'Cálculo Lunes y miércoles de 8 a 10 am',
    );
  });

  it('a day heading over several subjects gives each its own day', () => {
    expect(orderTimetable('Lunes: Redes 8-10, Cálculo 10-12', subjects)).toBe(
      'Redes Lunes de 8-10, Cálculo Lunes de 10-12',
    );
  });

  it('leaves alone what is already subject-first, or has nothing to move', () => {
    for (const text of [
      'Redes lunes 8-10, Cálculo martes 10-12',
      'Redes lunes de 7 a 9 y miércoles de 7 a 9, Cálculo martes de 7 a 9',
      'Parcial de Redes el viernes de 8 a 10',
      'El viernes 8-10 parcial de Redes',
      'Mañana tengo quiz de Física',
      '',
    ]) {
      expect(orderTimetable(text, subjects), text).toBeNull();
    }
  });

  it('moves nothing without a known subject', () => {
    expect(orderTimetable('Lunes 8-10 Anatomía, martes 10-12 Fisiología', subjects)).toBeNull();
    expect(orderTimetable('Lunes 8-10 Redes', [])).toBeNull();
  });
});

describe('timetables read through the whole engine', () => {
  it('hours first, subject after: every subject keeps its own day and hours', () => {
    expect(
      classes('Mi horario: lunes 7-9 Redes, martes 9-11 Cálculo, viernes 2-4 pm Inglés'),
    ).toEqual(['Redes d1 07:00-09:00', 'Cálculo d2 09:00-11:00', 'Inglés d5 14:00-16:00']);
    expect(
      classes(
        'Lunes 8-10 Redes, martes 10-12 Cálculo, miércoles 2-4 pm Física, jueves 8-10 Inglés, viernes 10-12 Bases de Datos',
      ),
    ).toEqual([
      'Redes d1 08:00-10:00',
      'Cálculo d2 10:00-12:00',
      'Física d3 14:00-16:00',
      'Inglés d4 08:00-10:00',
      'Bases de Datos d5 10:00-12:00',
    ]);
  });

  it('"tengo" before the subject and a last range with no "de"', () => {
    expect(
      classes(
        'Lunes y miércoles de 8 a 10 am tengo Cálculo, martes de 2 a 4 pm Física, jueves 10 a 12 Redes',
      ),
    ).toEqual([
      'Cálculo d1 08:00-10:00',
      'Cálculo d3 08:00-10:00',
      'Física d2 14:00-16:00',
      'Redes d4 10:00-12:00',
    ]);
  });

  it('a day heading over several subjects', () => {
    expect(
      classes('Lunes: Redes 8-10, Cálculo 10-12. Martes: Física 2-4 pm. Jueves: Inglés 8-10'),
    ).toEqual([
      'Redes d1 08:00-10:00',
      'Cálculo d1 10:00-12:00',
      'Física d2 14:00-16:00',
      'Inglés d4 08:00-10:00',
    ]);
    expect(
      classes('Los lunes tengo Redes de 8 a 10 y Cálculo de 10 a 12; los martes Física de 2 a 4'),
    ).toEqual(['Redes d1 08:00-10:00', 'Cálculo d1 10:00-12:00', 'Física d2 14:00-16:00']);
  });

  it('subject first with two days each and a comma between subjects keeps every day with its subject', () => {
    expect(
      classes(
        'Programación Web lunes de 7 a 9 y miércoles de 7 a 9, Bases de Datos martes de 7 a 9 y jueves de 7 a 9',
      ),
    ).toEqual([
      'Programación Web d1 07:00-09:00',
      'Programación Web d3 07:00-09:00',
      'Bases de Datos d2 07:00-09:00',
      'Bases de Datos d4 07:00-09:00',
    ]);
  });

  it('an activity word in front keeps the sentence an activity, never a class', () => {
    const r = read('Parcial el viernes de 8 a 10 de Redes');
    expect(r.suggestions).toEqual([]);
    expect(r.proposals.map((p) => p.type.value)).toEqual(['EXAM']);
  });
});

const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes'];

describe('generated: 300 timetables, any order, with a known answer', () => {
  it('hour-first, subject-first and day-heading timetables give every subject its own day and hours', () => {
    const rand = lcg(20261118);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const count = 2 + Math.floor(rand() * 4); // 2..5 subjects
      const subjects = [...SUBJECTS].sort(() => rand() - 0.5).slice(0, count);
      const days = [...DAYS].sort(() => rand() - 0.5).slice(0, count);
      const start = pick([7, 8, 9, 10]);
      const hours = subjects.map((_, i) => [start + (i % 2), start + (i % 2) + 2] as const);
      const style = pick(['hourFirst', 'subjectFirst', 'tengo'] as const);
      const range = (h: readonly [number, number]) =>
        pick([`${h[0]}-${h[1]}`, `de ${h[0]} a ${h[1]}`, `${h[0]} a ${h[1]}`]);
      const joiner = pick([', ', '; ', ' y ']);
      const items = subjects.map((s, i) => {
        const day = days[i]!;
        if (style === 'subjectFirst') return `${s} ${day} ${range(hours[i]!)}`;
        if (style === 'tengo') return `${day} ${range(hours[i]!)} tengo ${s}`;
        return `${day} ${range(hours[i]!)} ${s}`;
      });
      const text = `${pick(['', 'Mi horario: ', 'Tengo '])}${items.join(joiner)}`;
      const expected = subjects.map((s, i) => {
        const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
        return `${s} d${DAYS.indexOf(days[i]!) + 1} ${hh(hours[i]![0])}-${hh(hours[i]![1])}`;
      });
      expect(classes(text).sort(), text).toEqual([...expected].sort());
      checked++;
    }
    expect(checked).toBe(300);
  });
});
