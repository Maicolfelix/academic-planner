import type { Dashboard } from '@planner/core';
import { describe, expect, it } from 'vitest';
import {
  COMPANION_COPY,
  COMPANION_STATES,
  companionFromDashboard,
  companionClassLine,
  deriveCompanionState,
  type CompanionContext,
} from './companionState';

const ctx = (over: Partial<CompanionContext> = {}): CompanionContext => ({
  overdueCount: 0,
  immediateCount: 0,
  nextItemExists: false,
  hasActivities: true,
  ...over,
});

describe('deriveCompanionState', () => {
  it('nothing pressing and nothing coming up: REST', () => {
    expect(deriveCompanionState(ctx())).toBe('REST');
  });

  it('nothing pressing but something planned ahead: CALM', () => {
    expect(deriveCompanionState(ctx({ nextItemExists: true }))).toBe('CALM');
  });

  it('exactly one pressing thing (overdue or due today): FOCUSED', () => {
    expect(deriveCompanionState(ctx({ overdueCount: 1 }))).toBe('FOCUSED');
    expect(deriveCompanionState(ctx({ immediateCount: 1, nextItemExists: true }))).toBe('FOCUSED');
  });

  it('two or more pressing things: BUSY, whichever mix', () => {
    expect(deriveCompanionState(ctx({ immediateCount: 2 }))).toBe('BUSY');
    expect(deriveCompanionState(ctx({ overdueCount: 2 }))).toBe('BUSY');
    expect(deriveCompanionState(ctx({ overdueCount: 1, immediateCount: 1 }))).toBe('BUSY');
  });

  it('priority: pressing beats everything else (BUSY > FOCUSED > CALM > REST)', () => {
    expect(
      deriveCompanionState(ctx({ overdueCount: 3, immediateCount: 4, nextItemExists: true })),
    ).toBe('BUSY');
    expect(deriveCompanionState(ctx({ overdueCount: 1, nextItemExists: true }))).toBe('FOCUSED');
  });

  it('no data at all is CALM, never REST or BUSY', () => {
    expect(deriveCompanionState(ctx({ hasActivities: false }))).toBe('CALM');
    expect(deriveCompanionState(null)).toBe('CALM');
    expect(deriveCompanionState(undefined)).toBe('CALM');
    expect(deriveCompanionState({})).toBe('CALM');
  });

  it('zeros are zeros', () => {
    expect(deriveCompanionState(ctx({ overdueCount: 0, immediateCount: 0 }))).toBe('REST');
  });

  it('unexpected values count as zero instead of breaking', () => {
    const bad = {
      overdueCount: -3,
      immediateCount: Number.NaN,
      nextItemExists: true,
      hasActivities: true,
    } as CompanionContext;
    expect(deriveCompanionState(bad)).toBe('CALM');
    // A string or an infinity is not a count: it counts as zero.
    expect(
      deriveCompanionState({
        overdueCount: '2',
        immediateCount: Infinity,
        hasActivities: true,
      } as unknown as CompanionContext),
    ).toBe('REST');
  });

  it('is deterministic: the same input always gives the same state, whatever the order of calls', () => {
    const inputs = [
      ctx(),
      ctx({ nextItemExists: true }),
      ctx({ overdueCount: 1 }),
      ctx({ immediateCount: 5 }),
      ctx({ hasActivities: false }),
    ];
    const first = inputs.map(deriveCompanionState);
    for (let i = 0; i < 20; i++)
      expect([...inputs].reverse().map(deriveCompanionState).reverse()).toEqual(first);
  });

  it('only ever returns one of the declared states', () => {
    for (const o of [0, 1, 2, 7])
      for (const i of [0, 1, 2, 7])
        for (const next of [true, false])
          for (const has of [true, false])
            expect(COMPANION_STATES).toContain(
              deriveCompanionState({
                overdueCount: o,
                immediateCount: i,
                nextItemExists: next,
                hasActivities: has,
              }),
            );
  });
});

describe('copy', () => {
  it('one short, neutral line per state', () => {
    expect(COMPANION_COPY).toEqual({
      CALM: 'Todo en orden por ahora.',
      FOCUSED: 'Una cosa a la vez.',
      BUSY: 'Hay varias cosas cerca. Vamos por partes.',
      REST: 'Hoy se ve tranquilo.',
    });
  });

  it('never guilt, fear, comparison, false urgency, exclamations or childish language', () => {
    const banned =
      /atrasad|debes|deberías|tienes que|rápido|ya mismo|urgente|culpa|miedo|preocup|a tiempo|compañer|nivel|puntos|racha|premio|logro|¡|!|amiguito|vamos a (jugar|ganar)/i;
    for (const line of Object.values(COMPANION_COPY)) expect(line).not.toMatch(banned);
  });
});

describe('companionClassLine (the classes of today the Home already has)', () => {
  const TZ = 'America/Bogota';
  const cls = (title: string, start: string, end: string) => ({
    title,
    startAt: `2026-10-08T${start}:00.000Z`,
    endAt: `2026-10-08T${end}:00.000Z`,
  });
  // 08:00-10:00 and 14:00-16:00 in Bogotá (UTC-5)
  const classes = [
    cls('Farmacología', '19:00', '21:00'),
    cls('Redes de Computadores', '13:00', '15:00'),
  ];
  const at = (iso: string) => new Date(`2026-10-08T${iso}:00.000Z`);

  it('names the next class by start time, with its hour in 12 h', () => {
    expect(companionClassLine(classes, at('11:00'), TZ)).toMatch(
      /^Tu próxima clase es Redes de Computadores a las 8:00\s?a\. ?m\.\.$/,
    );
    expect(companionClassLine(classes, at('16:00'), TZ)).toMatch(
      /^Tu próxima clase es Farmacología a las 2:00\s?p\. ?m\.\.$/,
    );
  });

  it('says so while a class is on, and when none is left', () => {
    expect(companionClassLine(classes, at('14:00'), TZ)).toBe(
      'Tienes clase ahora: Redes de Computadores.',
    );
    expect(companionClassLine(classes, at('21:00'), TZ)).toBe('Hoy no quedan clases.');
    expect(companionClassLine(classes, at('22:30'), TZ)).toBe('Hoy no quedan clases.');
  });

  it('says nothing when there was no class today (the timetable may simply be unused)', () => {
    expect(companionClassLine([], at('12:00'), TZ)).toBeNull();
  });

  it('is independent of the order it is given and shortens a very long title', () => {
    expect(companionClassLine([...classes].reverse(), at('11:00'), TZ)).toBe(
      companionClassLine(classes, at('11:00'), TZ),
    );
    const long = companionClassLine([cls('x'.repeat(200), '19:00', '21:00')], at('11:00'), TZ)!;
    expect(long.length).toBeLessThan(110);
    expect(long).toContain('…');
  });

  it('never repeats an activity: it has no activity as input', () => {
    expect(companionClassLine.length).toBe(3);
  });
});

describe('companionFromDashboard (only what the Home already has)', () => {
  const act = (id: string, title: string) => ({ id, title }) as Dashboard['today'][number];
  const dash = (over: Partial<Dashboard>): Dashboard =>
    ({
      summary: { total: 3, pending: 3, inProgress: 0, completed: 0, overdue: 0 },
      today: [],
      overdue: [],
      nextDue: null,
      ...over,
    }) as unknown as Dashboard;

  it('counts overdue and due-today; the grades and the percentage play no part', () => {
    const context = companionFromDashboard(
      dash({
        summary: { total: 9, pending: 4, inProgress: 0, completed: 5, overdue: 2 },
        today: [act('a', 'A')],
        progress: { completed: 5, total: 9, percent: 56 },
      } as Partial<Dashboard>),
    );
    expect(context).toEqual({
      overdueCount: 2,
      immediateCount: 1,
      nextItemExists: false,
      hasActivities: true,
    });
  });

  it('carries no activity title at all (the hero says that)', () => {
    const context = companionFromDashboard(dash({ nextDue: act('n', 'Quiz próximo') }));
    expect(JSON.stringify(context)).not.toContain('Quiz próximo');
    expect(Object.keys(context).sort()).toEqual([
      'hasActivities',
      'immediateCount',
      'nextItemExists',
      'overdueCount',
    ]);
  });
});
