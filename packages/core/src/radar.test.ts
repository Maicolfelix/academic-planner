import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_STATUSES,
  RADAR_GROUP_LABELS,
  RADAR_IMMEDIATE_MS,
  RADAR_KEYS,
  RADAR_LABELS,
  RADAR_PLANNABLE_MS,
  RADAR_STATUSES,
  RADAR_SYMBOLS,
  RADAR_UPCOMING_MS,
  calculateRadarStatus,
  isOverdue,
  listActivitiesQuerySchema,
  radarDueRange,
  radarExplanation,
  radarSchema,
  type ActivityStatus,
  type RadarStatus,
} from './index.js';

const NOW = new Date('2026-10-05T17:00:00.000Z'); // Monday 12:00 in Bogotá
const BOGOTA = 'America/Bogota';
const TOKYO = 'Asia/Tokyo';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** An activity due `ms` after NOW (negative = already past). */
const due = (ms: number, status: ActivityStatus = 'PENDING') => ({
  dueAt: new Date(NOW.getTime() + ms),
  status,
});
const radar = (ms: number, status: ActivityStatus = 'PENDING') =>
  calculateRadarStatus(due(ms, status), NOW);

describe('thresholds', () => {
  it('are exactly 24 h, 72 h and 7 days', () => {
    expect(RADAR_IMMEDIATE_MS).toBe(24 * HOUR);
    expect(RADAR_UPCOMING_MS).toBe(72 * HOUR);
    expect(RADAR_PLANNABLE_MS).toBe(7 * DAY);
  });
});

describe('calculateRadarStatus: exact boundaries (real duration, no gaps, no overlaps)', () => {
  it.each<[string, number, RadarStatus]>([
    ['1 ms overdue', -1, 'OVERDUE'],
    ['1 hour overdue', -HOUR, 'OVERDUE'],
    ['10 days overdue', -10 * DAY, 'OVERDUE'],
    ['exactly at the deadline (not overdue yet, like isOverdue)', 0, 'IMMEDIATE'],
    ['1 ms left', 1, 'IMMEDIATE'],
    ['5 hours left', 5 * HOUR, 'IMMEDIATE'],
    ['23 h 59 min 59 s left', 24 * HOUR - 1000, 'IMMEDIATE'],
    ['24 h minus 1 ms', 24 * HOUR - 1, 'IMMEDIATE'],
    ['exactly 24 h', 24 * HOUR, 'UPCOMING'],
    ['24 h + 1 ms', 24 * HOUR + 1, 'UPCOMING'],
    ['2 days', 2 * DAY, 'UPCOMING'],
    ['72 h minus 1 ms', 72 * HOUR - 1, 'UPCOMING'],
    ['exactly 72 h', 72 * HOUR, 'UPCOMING'],
    ['72 h + 1 ms', 72 * HOUR + 1, 'PLANNABLE'],
    ['5 days', 5 * DAY, 'PLANNABLE'],
    ['7 days minus 1 ms', 7 * DAY - 1, 'PLANNABLE'],
    ['exactly 7 days', 7 * DAY, 'PLANNABLE'],
    ['7 days + 1 ms', 7 * DAY + 1, 'UNDER_CONTROL'],
    ['12 days', 12 * DAY, 'UNDER_CONTROL'],
    ['a year', 365 * DAY, 'UNDER_CONTROL'],
  ])('%s -> %s', (_label, ms, expected) => {
    expect(radar(ms)).toBe(expected);
  });

  it('accepts the deadline as an ISO string (what the API returns)', () => {
    const dueAt = new Date(NOW.getTime() + 2 * HOUR).toISOString();
    expect(calculateRadarStatus({ dueAt, status: 'PENDING' }, NOW)).toBe('IMMEDIATE');
  });

  it('is monotonic: the closer the deadline, the equal-or-more urgent the status', () => {
    const rank = (s: RadarStatus | null) => RADAR_STATUSES.indexOf(s!);
    let previous = -1;
    for (let ms = -2 * DAY; ms <= 9 * DAY; ms += 30 * 60_000) {
      const current = rank(radar(ms));
      // RADAR_STATUSES goes from most to least urgent: the index can only grow as the deadline moves away.
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('completed activities have no Radar category', () => {
  it.each([-10 * DAY, -1, 0, HOUR, 2 * DAY, 5 * DAY, 30 * DAY])(
    'COMPLETED due in %i ms -> null',
    (ms) => {
      expect(radar(ms, 'COMPLETED')).toBeNull();
    },
  );
});

describe('status participation', () => {
  it('PENDING and IN_PROGRESS are classified identically', () => {
    for (const ms of [-DAY, 0, 5 * HOUR, 2 * DAY, 5 * DAY, 20 * DAY]) {
      expect(radar(ms, 'IN_PROGRESS')).toBe(radar(ms, 'PENDING'));
      expect(radar(ms, 'PENDING')).not.toBeNull();
    }
  });

  it('OVERDUE is a Radar condition, never a stored status', () => {
    expect(ACTIVITY_STATUSES).not.toContain('OVERDUE');
    expect(radar(-1, 'PENDING')).toBe('OVERDUE');
    expect(radar(-1, 'IN_PROGRESS')).toBe('OVERDUE');
  });

  it('agrees with isOverdue everywhere: OVERDUE <=> isOverdue', () => {
    for (const status of ACTIVITY_STATUSES) {
      for (const ms of [-DAY, -1, 0, 1, DAY]) {
        const a = due(ms, status);
        expect(calculateRadarStatus(a, NOW) === 'OVERDUE').toBe(isOverdue(a, NOW));
      }
    }
  });
});

describe('Radar is not priority', () => {
  it('LOW priority due in 2 hours is IMMEDIATE; HIGH priority due in 10 days is UNDER_CONTROL', () => {
    const withPriority = (priority: 'LOW' | 'HIGH', ms: number) => {
      const activity: Parameters<typeof calculateRadarStatus>[0] & { priority: string } = {
        ...due(ms),
        priority,
      };
      return activity;
    };
    const low = withPriority('LOW', 2 * HOUR);
    const high = withPriority('HIGH', 10 * DAY);
    expect(calculateRadarStatus(low, NOW)).toBe('IMMEDIATE');
    expect(calculateRadarStatus(high, NOW)).toBe('UNDER_CONTROL');
  });

  it('the result never changes with the priority', () => {
    for (const ms of [-DAY, HOUR, 2 * DAY, 5 * DAY, 20 * DAY]) {
      const results = ACTIVITY_PRIORITIES.map((priority) => {
        const activity = { ...due(ms), priority };
        return calculateRadarStatus(activity, NOW);
      });
      expect(new Set(results).size).toBe(1);
    }
  });
});

describe('timezone: the category depends on the instant, only the wording may vary', () => {
  // Tomorrow 10:00 in Bogotá = 22 h from NOW (and 00:00 Wednesday in Tokyo: another calendar date).
  const activity = { dueAt: new Date('2026-10-06T15:00:00.000Z'), status: 'PENDING' as const };

  it('the same dueAt and the same now give the same category: the rule takes no timezone at all', () => {
    expect(calculateRadarStatus(activity, NOW)).toBe('IMMEDIATE');
    expect(calculateRadarStatus.length).toBe(2); // (activity, now): nothing else can influence it
    expect(radarExplanation(activity, NOW, BOGOTA)).toBe('Vence en 22 horas');
    expect(radarExplanation(activity, NOW, TOKYO)).toBe('Vence en 22 horas');
  });

  it('23 h left is IMMEDIATE even though the local calendar says "tomorrow"', () => {
    const tomorrowMorning = {
      dueAt: new Date(NOW.getTime() + 23 * HOUR),
      status: 'PENDING' as const,
    };
    expect(calculateRadarStatus(tomorrowMorning, NOW)).toBe('IMMEDIATE');
    expect(radarExplanation(tomorrowMorning, NOW, BOGOTA)).toBe('Vence en 23 horas');
    expect(radarExplanation(tomorrowMorning, NOW, TOKYO)).toBe('Vence en 23 horas'); // same text: real duration
  });

  it('outside the last 24 h the wording uses the user’s calendar, so it may differ by timezone', () => {
    const fiveDays = {
      dueAt: new Date(NOW.getTime() + 5 * DAY + 2 * HOUR),
      status: 'PENDING' as const,
    };
    expect(calculateRadarStatus(fiveDays, NOW)).toBe('PLANNABLE');
    expect(radarExplanation(fiveDays, NOW, BOGOTA)).toMatch(/^Vence en \d+ días$/);
    expect(radarExplanation(fiveDays, NOW, TOKYO)).toMatch(/^Vence en \d+ días$/);
  });
});

describe('radarDueRange agrees with calculateRadarStatus', () => {
  const inRange = (range: ReturnType<typeof radarDueRange>, t: number) =>
    (range.gt === undefined || t > range.gt.getTime()) &&
    (range.gte === undefined || t >= range.gte.getTime()) &&
    (range.lt === undefined || t < range.lt.getTime()) &&
    (range.lte === undefined || t <= range.lte.getTime());

  // Offsets chosen around every limit: ±1 ms, exact, and well inside each band.
  const probes = [
    -DAY,
    -1,
    0,
    1,
    5 * HOUR,
    24 * HOUR - 1,
    24 * HOUR,
    24 * HOUR + 1,
    2 * DAY,
    72 * HOUR - 1,
    72 * HOUR,
    72 * HOUR + 1,
    5 * DAY,
    7 * DAY - 1,
    7 * DAY,
    7 * DAY + 1,
    30 * DAY,
  ];

  it('every instant lands in exactly one range, the one the function names', () => {
    for (const ms of probes) {
      const t = NOW.getTime() + ms;
      const matching = RADAR_STATUSES.filter((s) => inRange(radarDueRange(s, NOW), t));
      expect(matching, `offset ${ms} ms`).toEqual([radar(ms)]);
    }
  });

  it('the ranges cover the timeline without gaps (0.5 h sweep over 10 days)', () => {
    for (let ms = -3 * DAY; ms <= 10 * DAY; ms += 1_800_000) {
      const t = NOW.getTime() + ms;
      const matching = RADAR_STATUSES.filter((s) => inRange(radarDueRange(s, NOW), t));
      expect(matching).toHaveLength(1);
    }
  });
});

describe('radarExplanation', () => {
  const text = (ms: number, status: ActivityStatus = 'PENDING') =>
    radarExplanation(due(ms, status), NOW, BOGOTA);

  it('IMMEDIATE states the real time left', () => {
    expect(text(5 * HOUR)).toBe('Vence en 5 horas');
    expect(text(5 * HOUR + 40 * 60_000)).toBe('Vence en 5 horas');
    expect(text(HOUR)).toBe('Vence en 1 hora');
    expect(text(35 * 60_000)).toBe('Vence en 35 minutos');
    expect(text(60_000)).toBe('Vence en 1 minuto');
    expect(text(30_000)).toBe('Vence en menos de un minuto');
    expect(text(0)).toBe('Vence ahora');
  });

  it('other categories reuse the app’s calendar wording', () => {
    expect(text(2 * DAY)).toBe('Vence en 2 días'); // Wednesday 12:00 -> 2 local days ahead
    expect(text(5 * DAY)).toBe('Vence en 5 días');
    expect(text(12 * DAY)).toBe('Vence en 12 días');
    expect(text(-2 * DAY)).toBe('Venció hace 2 días');
  });

  it('completed activities have no Radar text', () => {
    expect(text(5 * HOUR, 'COMPLETED')).toBe('');
  });
});

describe('labels and symbols', () => {
  it('every status has a label, a group label, a symbol and a response key', () => {
    for (const s of RADAR_STATUSES) {
      expect(RADAR_LABELS[s]).toBeTruthy();
      expect(RADAR_GROUP_LABELS[s]).toBeTruthy();
      expect(RADAR_SYMBOLS[s]).toBeTruthy();
      expect(RADAR_KEYS[s]).toBeTruthy();
    }
    expect(RADAR_LABELS.IMMEDIATE).toBe('Atención inmediata');
    expect(new Set(Object.values(RADAR_LABELS)).size).toBe(5); // never ambiguous: two reds still differ in text
  });
});

describe('schemas', () => {
  it('the activities query accepts a valid radar category and rejects an unknown one', () => {
    expect(listActivitiesQuerySchema.parse({ radar: 'IMMEDIATE' }).radar).toBe('IMMEDIATE');
    expect(listActivitiesQuerySchema.safeParse({ radar: 'COMPLETED' }).success).toBe(false);
    expect(listActivitiesQuerySchema.safeParse({ radar: 'immediate' }).success).toBe(false);
  });

  it('the Radar response must have the five summaries and the five groups', () => {
    const empty = { overdue: 0, immediate: 0, upcoming: 0, plannable: 0, underControl: 0 };
    const groups = { overdue: [], immediate: [], upcoming: [], plannable: [], underControl: [] };
    const ok = { generatedAt: NOW.toISOString(), period: null, summary: empty, groups };
    expect(radarSchema.safeParse(ok).success).toBe(true);
    expect(
      radarSchema.safeParse({ ...ok, summary: { ...empty, underControl: undefined } }).success,
    ).toBe(false);
    expect(
      radarSchema.safeParse({ ...ok, groups: { ...groups, immediate: undefined } }).success,
    ).toBe(false);
  });
});
