import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_PRIORITIES,
  ATTENTION_ALTERNATIVES_LIMIT,
  ATTENTION_IN_PROGRESS_BONUS,
  ATTENTION_PRIORITY_WEIGHTS,
  ATTENTION_STALE_OVERDUE_MS,
  ATTENTION_TIER_WEIGHTS,
  attentionSchema,
  attentionTier,
  buildAttentionReasons,
  calculateAttentionScore,
  HERO_MAX_ACTIVITIES,
  compareAttentionCandidates,
  nearestDeadlines,
  rankActivitiesForAttention,
  type ActivityPriority,
  type ActivityStatus,
  type AttentionCandidate,
  type AttentionInput,
  type RadarStatus,
} from './index.js';

const NOW = new Date('2026-10-05T17:00:00.000Z'); // Monday 12:00 in Bogotá
const BOGOTA = 'America/Bogota';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CREATED = new Date('2026-09-01T00:00:00.000Z');

let seq = 0;
/** An activity due `ms` from NOW. Unique ids by default. */
const act = (
  ms: number,
  priority: ActivityPriority = 'MEDIUM',
  status: ActivityStatus = 'PENDING',
  extra: Partial<AttentionInput> = {},
): AttentionInput => ({
  id: `a-${String(++seq).padStart(4, '0')}`,
  dueAt: new Date(NOW.getTime() + ms),
  status,
  priority,
  createdAt: CREATED,
  ...extra,
});
const score = (a: AttentionInput) => calculateAttentionScore(a, NOW);
const winner = (...list: AttentionInput[]) => rankActivitiesForAttention(list, NOW)[0]!.activity;

// One representative offset inside each Radar category.
const IN_TIER: Record<RadarStatus, number> = {
  OVERDUE: -2 * DAY,
  IMMEDIATE: 5 * HOUR,
  UPCOMING: 2 * DAY,
  PLANNABLE: 5 * DAY,
  UNDER_CONTROL: 12 * DAY,
};

describe('weights', () => {
  it('are the documented ones', () => {
    expect(ATTENTION_TIER_WEIGHTS).toEqual({
      OVERDUE: 60,
      IMMEDIATE: 50,
      UPCOMING: 40,
      PLANNABLE: 30,
      OVERDUE_STALE: 20,
      UNDER_CONTROL: 10,
    });
    expect(ATTENTION_PRIORITY_WEIGHTS).toEqual({ HIGH: 9, MEDIUM: 5, LOW: 1 });
    expect(ATTENTION_IN_PROGRESS_BONUS).toBe(1);
  });

  it('invariant: the biggest priority + status boost is smaller than the gap between tiers', () => {
    const tiers = Object.values(ATTENTION_TIER_WEIGHTS).sort((a, b) => a - b);
    const minGap = Math.min(...tiers.slice(1).map((w, i) => w - tiers[i]!));
    const prio = Object.values(ATTENTION_PRIORITY_WEIGHTS);
    const maxSpread = Math.max(...prio) + ATTENTION_IN_PROGRESS_BONUS - Math.min(...prio);
    expect(maxSpread).toBeLessThan(minGap);
  });

  it('exhaustively: no activity of a less urgent tier ever beats a more urgent one, whatever priority or status', () => {
    const order: RadarStatus[] = ['OVERDUE', 'IMMEDIATE', 'UPCOMING', 'PLANNABLE', 'UNDER_CONTROL'];
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        for (const pLow of ACTIVITY_PRIORITIES) {
          for (const pHigh of ACTIVITY_PRIORITIES) {
            for (const sLow of ['PENDING', 'IN_PROGRESS'] as const) {
              for (const sHigh of ['PENDING', 'IN_PROGRESS'] as const) {
                const urgent = act(IN_TIER[order[i]!], pHigh, sHigh);
                const calm = act(IN_TIER[order[j]!], pLow, sLow);
                expect(score(urgent)!).toBeGreaterThan(score(calm)!);
              }
            }
          }
        }
      }
    }
  });
});

describe('Radar category dominates', () => {
  it('OVERDUE > IMMEDIATE > UPCOMING > PLANNABLE > UNDER_CONTROL with the same priority and status', () => {
    const scores = (
      ['OVERDUE', 'IMMEDIATE', 'UPCOMING', 'PLANNABLE', 'UNDER_CONTROL'] as const
    ).map((t) => score(act(IN_TIER[t]))!);
    expect(scores).toEqual([65, 55, 45, 35, 15]); // 60/50/40/30/10 + MEDIUM (5)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('ranks a mixed list from most to least urgent', () => {
    const list = [
      act(IN_TIER.UNDER_CONTROL),
      act(IN_TIER.UPCOMING),
      act(IN_TIER.OVERDUE),
      act(IN_TIER.PLANNABLE),
      act(IN_TIER.IMMEDIATE),
    ];
    const radar = rankActivitiesForAttention(list, NOW).map((c) => c.radarStatus);
    expect(radar).toEqual(['OVERDUE', 'IMMEDIATE', 'UPCOMING', 'PLANNABLE', 'UNDER_CONTROL']);
  });

  it('reports the Radar category of the phase 8 rule (the engine does not reimplement it)', () => {
    const [c] = rankActivitiesForAttention([act(IN_TIER.IMMEDIATE)], NOW);
    expect(c!.radarStatus).toBe('IMMEDIATE');
    expect(rankActivitiesForAttention([act(-30 * DAY)], NOW)[0]!.radarStatus).toBe('OVERDUE'); // stale is still OVERDUE for the Radar
  });
});

describe('priority and status inside the same category', () => {
  it('HIGH > MEDIUM > LOW', () => {
    const [h, m, l] = ACTIVITY_PRIORITIES.map((p) => ({ p, s: score(act(2 * DAY, p))! })).sort(
      (a, b) => ATTENTION_PRIORITY_WEIGHTS[b.p] - ATTENTION_PRIORITY_WEIGHTS[a.p],
    );
    expect(h!.p).toBe('HIGH');
    expect(h!.s).toBeGreaterThan(m!.s);
    expect(m!.s).toBeGreaterThan(l!.s);
  });

  it('IN_PROGRESS beats PENDING when everything else is equal', () => {
    const started = act(5 * HOUR, 'HIGH', 'IN_PROGRESS');
    const pending = act(5 * HOUR, 'HIGH', 'PENDING');
    expect(score(started)! - score(pending)!).toBe(ATTENTION_IN_PROGRESS_BONUS);
    expect(winner(pending, started)).toBe(started);
  });

  it('but the bonus is not dominant: a higher priority still wins over "already started"', () => {
    const startedMedium = act(5 * HOUR, 'MEDIUM', 'IN_PROGRESS');
    const pendingHigh = act(5 * HOUR, 'HIGH', 'PENDING');
    expect(winner(startedMedium, pendingHigh)).toBe(pendingHigh);
    const startedLow = act(2 * DAY, 'LOW', 'IN_PROGRESS');
    const pendingMedium = act(2 * DAY, 'MEDIUM', 'PENDING');
    expect(winner(startedLow, pendingMedium)).toBe(pendingMedium);
  });

  it('PENDING and IN_PROGRESS both take part', () => {
    expect(score(act(DAY, 'LOW', 'PENDING'))).not.toBeNull();
    expect(score(act(DAY, 'LOW', 'IN_PROGRESS'))).not.toBeNull();
  });
});

describe('real scenarios', () => {
  it('LOW due in 2 hours beats HIGH due in 10 days', () => {
    const lowSoon = act(2 * HOUR, 'LOW');
    const highFar = act(10 * DAY, 'HIGH');
    expect(score(lowSoon)).toBe(51); // 50 + 1
    expect(score(highFar)).toBe(19); // 10 + 9
    expect(winner(highFar, lowSoon)).toBe(lowSoon);
  });

  it('LOW due in 15 days loses to a HIGH one due in 15 days and never beats a close deadline', () => {
    expect(winner(act(15 * DAY, 'LOW'), act(15 * DAY, 'HIGH')).priority).toBe('HIGH');
    expect(winner(act(15 * DAY, 'HIGH'), act(2 * HOUR, 'LOW')).priority).toBe('LOW');
  });

  it('HIGH due in 2 days beats LOW due in 3 days (same category: priority decides)', () => {
    const lowThree = act(3 * DAY, 'LOW'); // exactly 72 h: still UPCOMING
    const highTwo = act(2 * DAY, 'HIGH');
    expect(score(lowThree)).toBe(41);
    expect(score(highTwo)).toBe(49);
    expect(winner(lowThree, highTwo)).toBe(highTwo);
  });

  it('HIGH due in 2 days beats LOW due in 2 days', () => {
    expect(winner(act(2 * DAY, 'LOW'), act(2 * DAY, 'HIGH')).priority).toBe('HIGH');
  });

  it('HIGH IN_PROGRESS beats HIGH PENDING with nearly equal deadlines', () => {
    const started = act(5 * HOUR + 60_000, 'HIGH', 'IN_PROGRESS');
    const pending = act(5 * HOUR, 'HIGH', 'PENDING');
    expect(winner(pending, started)).toBe(started);
  });

  it('documented behavior: inside a category the boost outranks a LATER-than-expected deadline (12 h pending vs 13 h started)', () => {
    const pending12 = act(12 * HOUR, 'HIGH', 'PENDING');
    const started13 = act(13 * HOUR, 'HIGH', 'IN_PROGRESS');
    expect(score(pending12)).toBe(59);
    expect(score(started13)).toBe(60);
    expect(winner(pending12, started13)).toBe(started13); // score first; dueAt only breaks ties
  });

  it('documented limit of the category: HIGH due in 23 h goes before LOW due in 1 h (no continuous time term)', () => {
    const highLater = act(23 * HOUR, 'HIGH');
    const lowSoon = act(HOUR, 'LOW');
    expect(score(highLater)).toBe(59);
    expect(score(lowSoon)).toBe(51);
    expect(rankActivitiesForAttention([lowSoon, highLater], NOW).map((c) => c.activity)).toEqual([
      highLater,
      lowSoon,
    ]);
  });

  it('HIGH due in 5 days beats LOW due in 10 days; LOW due in 5 hours beats both', () => {
    const lowFar = act(10 * DAY, 'LOW');
    const highMid = act(5 * DAY, 'HIGH');
    const lowSoon = act(5 * HOUR, 'LOW');
    const ranked = rankActivitiesForAttention([lowFar, highMid, lowSoon], NOW).map(
      (c) => c.activity,
    );
    expect(ranked).toEqual([lowSoon, highMid, lowFar]);
  });
});

describe('overdue activities', () => {
  it('overdue yesterday is the top tier', () => {
    const yesterday = act(-DAY, 'LOW');
    expect(attentionTier(yesterday, NOW)).toBe('OVERDUE');
    expect(score(yesterday)).toBe(61);
    expect(winner(act(HOUR, 'HIGH', 'IN_PROGRESS'), yesterday)).toBe(yesterday); // vs IMMEDIATE 50+9+1
  });

  it('the score is finite: it does not grow with how long ago the deadline was', () => {
    const scores = [-DAY, -8 * DAY, -30 * DAY, -365 * DAY, -3650 * DAY].map((ms) =>
      score(act(ms))!,
    );
    expect(scores.every(Number.isFinite)).toBe(true);
    expect(scores[2]).toBe(scores[3]); // a month and a year late weigh the same
    expect(scores[3]).toBe(scores[4]);
  });

  it('scores at the stale limit: exactly 7 days = 65, 7 days + 1 ms = 25 (MEDIUM)', () => {
    expect(score(act(-ATTENTION_STALE_OVERDUE_MS))).toBe(65);
    expect(score(act(-ATTENTION_STALE_OVERDUE_MS - 1))).toBe(25);
  });

  it('stale limit: exactly 7 days overdue is still recent, 7 days + 1 ms is stale', () => {
    expect(attentionTier(act(-ATTENTION_STALE_OVERDUE_MS), NOW)).toBe('OVERDUE');
    expect(attentionTier(act(-ATTENTION_STALE_OVERDUE_MS - 1), NOW)).toBe('OVERDUE_STALE');
    expect(attentionTier(act(-ATTENTION_STALE_OVERDUE_MS + 1), NOW)).toBe('OVERDUE');
  });

  it('an activity overdue for a month does not dominate: something due in 1 hour wins', () => {
    const ancient = act(-30 * DAY, 'HIGH', 'IN_PROGRESS');
    const soon = act(HOUR, 'LOW');
    expect(winner(ancient, soon)).toBe(soon);
  });

  it('a stale overdue activity still ranks above things due in more than a week, and below anything due within 7 days', () => {
    const stale = act(-30 * DAY, 'LOW');
    expect(winner(stale, act(12 * DAY, 'HIGH'))).toBe(stale);
    expect(winner(stale, act(5 * DAY, 'LOW')).id).not.toBe(stale.id); // PLANNABLE
    expect(winner(stale, act(2 * DAY, 'LOW')).id).not.toBe(stale.id); // UPCOMING
  });

  it('when only stale overdue activities exist, one is still recommended (the oldest deadline first)', () => {
    const a = act(-30 * DAY);
    const b = act(-60 * DAY);
    expect(winner(a, b)).toBe(b);
  });

  it('between recent overdue ones, the most overdue goes first (same as the Dashboard)', () => {
    const a = act(-DAY);
    const b = act(-3 * DAY);
    expect(winner(a, b)).toBe(b);
  });
});

describe('completed activities never take part', () => {
  it('have no score, no tier and are dropped from the ranking', () => {
    const done = act(HOUR, 'HIGH', 'COMPLETED');
    expect(score(done)).toBeNull();
    expect(attentionTier(done, NOW)).toBeNull();
    const open = act(10 * DAY, 'LOW');
    expect(rankActivitiesForAttention([done, open], NOW).map((c) => c.activity)).toEqual([open]);
    expect(rankActivitiesForAttention([done], NOW)).toEqual([]);
    expect(rankActivitiesForAttention([], NOW)).toEqual([]);
  });
});

describe('determinism', () => {
  const list = [
    act(5 * HOUR, 'LOW'),
    act(5 * HOUR, 'HIGH'),
    act(2 * DAY, 'HIGH', 'IN_PROGRESS'),
    act(2 * DAY, 'MEDIUM'),
    act(-DAY, 'MEDIUM'),
    act(-40 * DAY, 'HIGH'),
    act(12 * DAY, 'LOW'),
    act(HOUR, 'LOW', 'COMPLETED'),
  ];
  const ids = (l: AttentionInput[]) => rankActivitiesForAttention(l, NOW).map((c) => c.activity.id);

  it('the same inputs and the same now always give the same result', () => {
    expect(ids(list)).toEqual(ids(list));
    expect(JSON.stringify(rankActivitiesForAttention(list, NOW))).toBe(
      JSON.stringify(rankActivitiesForAttention(list, NOW)),
    );
  });

  it('the result does not depend on the order the activities arrive in', () => {
    const expected = ids(list);
    const reversed = [...list].reverse();
    const rotated = [...list.slice(3), ...list.slice(0, 3)];
    expect(ids(reversed)).toEqual(expected);
    expect(ids(rotated)).toEqual(expected);
  });

  it('does not mutate its input', () => {
    const copy = [...list];
    rankActivitiesForAttention(list, NOW);
    expect(list).toEqual(copy);
  });

  it('a total tie (same tier, priority, status, deadline) resolves by creation date, then by id', () => {
    const due = 2 * DAY;
    const older = act(due, 'MEDIUM', 'PENDING', { id: 'zzz', createdAt: new Date('2026-08-01') });
    const newerA = act(due, 'MEDIUM', 'PENDING', { id: 'aaa', createdAt: new Date('2026-09-01') });
    const newerB = act(due, 'MEDIUM', 'PENDING', { id: 'bbb', createdAt: new Date('2026-09-01') });
    const order = (l: AttentionInput[]) =>
      rankActivitiesForAttention(l, NOW).map((c) => c.activity.id);
    expect(order([newerB, older, newerA])).toEqual(['zzz', 'aaa', 'bbb']);
    expect(order([newerA, newerB, older])).toEqual(['zzz', 'aaa', 'bbb']);
    expect(order([older, newerA, newerB])).toEqual(['zzz', 'aaa', 'bbb']);
  });

  it('a tie on score is broken by the earlier deadline', () => {
    const early = act(3 * HOUR, 'MEDIUM');
    const late = act(9 * HOUR, 'MEDIUM');
    expect(winner(late, early)).toBe(early);
  });
});

describe('compareAttentionCandidates: every tie-break step', () => {
  const cand = (over: Partial<AttentionInput>, score = 50): AttentionCandidate => ({
    activity: { ...act(5 * HOUR), ...over },
    score,
    radarStatus: 'IMMEDIATE',
  });

  it('1. higher score first', () => {
    expect(compareAttentionCandidates(cand({}, 51), cand({}, 50))).toBeLessThan(0);
  });
  it('2. same score: earlier deadline first', () => {
    const early = cand({ dueAt: new Date(NOW.getTime() + HOUR) });
    const late = cand({ dueAt: new Date(NOW.getTime() + 2 * HOUR) });
    expect(compareAttentionCandidates(early, late)).toBeLessThan(0);
    expect(compareAttentionCandidates(late, early)).toBeGreaterThan(0);
  });
  it('3. same score and deadline: IN_PROGRESS before PENDING', () => {
    const due = new Date(NOW.getTime() + HOUR);
    const started = cand({ dueAt: due, status: 'IN_PROGRESS' });
    const pending = cand({ dueAt: due, status: 'PENDING' });
    expect(compareAttentionCandidates(started, pending)).toBeLessThan(0);
    expect(compareAttentionCandidates(pending, started)).toBeGreaterThan(0);
  });
  it('4. then the higher priority', () => {
    const due = new Date(NOW.getTime() + HOUR);
    const high = cand({ dueAt: due, priority: 'HIGH' });
    const low = cand({ dueAt: due, priority: 'LOW' });
    expect(compareAttentionCandidates(high, low)).toBeLessThan(0);
  });
  it('5. then the older creation date, 6. then the id', () => {
    const due = new Date(NOW.getTime() + HOUR);
    const old = cand({ dueAt: due, createdAt: new Date('2026-01-01'), id: 'b' });
    const recent = cand({ dueAt: due, createdAt: new Date('2026-02-01'), id: 'a' });
    expect(compareAttentionCandidates(old, recent)).toBeLessThan(0);
    const x = cand({ dueAt: due, id: 'a' });
    const y = cand({ dueAt: due, id: 'b' });
    expect(compareAttentionCandidates(x, y)).toBeLessThan(0);
    expect(compareAttentionCandidates(x, x)).toBe(0);
  });
  it('accepts ISO strings (what the API stores/returns)', () => {
    const a = cand({ dueAt: new Date(NOW.getTime() + HOUR).toISOString() });
    const b = cand({ dueAt: new Date(NOW.getTime() + 2 * HOUR).toISOString() });
    expect(compareAttentionCandidates(a, b)).toBeLessThan(0);
  });
});

describe('buildAttentionReasons', () => {
  const reasons = (
    ms: number,
    priority: ActivityPriority = 'MEDIUM',
    status: ActivityStatus = 'PENDING',
    tz = BOGOTA,
  ) => buildAttentionReasons(act(ms, priority, status), NOW, tz);

  it('one fixed sentence per Radar category', () => {
    expect(reasons(5 * HOUR)).toEqual(['Vence en menos de 24 horas.']);
    expect(reasons(2 * DAY)).toEqual(['Vence en los próximos 3 días.']);
    expect(reasons(5 * DAY)).toEqual(['Vence durante esta semana.']);
    expect(reasons(12 * DAY)).toEqual(['La fecha límite aún está a más de una semana.']);
  });

  it('overdue keeps "ya está vencida" first and adds the app’s usual wording', () => {
    expect(reasons(-DAY)).toEqual(['Esta actividad ya está vencida.', 'Venció ayer.']);
    expect(reasons(-3 * DAY)).toEqual(['Esta actividad ya está vencida.', 'Venció hace 3 días.']);
    expect(reasons(-30 * DAY)).toEqual(['Esta actividad ya está vencida.', 'Venció hace 30 días.']);
  });

  it('only HIGH priority and IN_PROGRESS are reasons; medium and low are not mentioned', () => {
    expect(reasons(5 * HOUR, 'HIGH', 'IN_PROGRESS')).toEqual([
      'Vence en menos de 24 horas.',
      'Tiene prioridad alta.',
      'Ya comenzaste esta actividad.',
    ]);
    expect(reasons(5 * HOUR, 'LOW')).toEqual(['Vence en menos de 24 horas.']);
    expect(reasons(5 * HOUR, 'MEDIUM', 'IN_PROGRESS')).toEqual([
      'Vence en menos de 24 horas.',
      'Ya comenzaste esta actividad.',
    ]);
  });

  it('never states the score, never orders the student around', () => {
    const all = [
      ...reasons(-DAY, 'HIGH', 'IN_PROGRESS'),
      ...reasons(5 * HOUR, 'HIGH', 'IN_PROGRESS'),
      ...reasons(12 * DAY, 'HIGH', 'IN_PROGRESS'),
    ].join(' ');
    expect(all).not.toMatch(/\d{2,}\s*(puntos|pts)|score|debes|urgente|atrasad/i);
  });

  it('completed activities have no reasons', () => {
    expect(reasons(5 * HOUR, 'HIGH', 'COMPLETED')).toEqual([]);
  });

  it('the overdue wording follows the calendar of the profile timezone; the category does not', () => {
    const dueAt = new Date('2026-10-04T05:30:00.000Z'); // Sat 00:30 Bogotá, Sat 14:30 Tokyo
    const a = { dueAt, status: 'PENDING' as const, priority: 'LOW' as const };
    expect(calculateAttentionScore(a, NOW)).toBe(61);
    expect(buildAttentionReasons(a, NOW, BOGOTA)[0]).toBe('Esta actividad ya está vencida.');
    expect(buildAttentionReasons(a, NOW, 'Asia/Tokyo')[0]).toBe('Esta actividad ya está vencida.');
  });

  it('is deterministic', () => {
    expect(reasons(5 * HOUR, 'HIGH', 'IN_PROGRESS')).toEqual(
      reasons(5 * HOUR, 'HIGH', 'IN_PROGRESS'),
    );
  });
});

describe('response schema', () => {
  const item = {
    activity: {
      id: '0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11',
      subjectId: '1b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11',
      title: 'Proyecto final',
      description: null,
      type: 'PROJECT',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      dueAt: NOW.toISOString(),
      hasTime: true,
      completedAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      subject: {
        id: '1b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11',
        name: 'Bases de Datos',
        color: '#3366FF',
      },
    },
    radarStatus: 'IMMEDIATE',
    reasons: ['Vence en menos de 24 horas.'],
  };
  const base = {
    generatedAt: NOW.toISOString(),
    period: null,
    recommendation: item,
    alternatives: [],
    upcoming: [item],
  };

  it('accepts a recommendation, or null when nothing is open', () => {
    expect(attentionSchema.safeParse(base).success).toBe(true);
    expect(attentionSchema.safeParse({ ...base, recommendation: null }).success).toBe(true);
  });

  it('holds at most the documented number of alternatives and has no score field', () => {
    expect(attentionSchema.safeParse({ ...base, alternatives: [item, item] }).success).toBe(true);
    expect(ATTENTION_ALTERNATIVES_LIMIT).toBe(2);
    expect(attentionSchema.safeParse({ ...base, alternatives: [item, item, item] }).success).toBe(
      false,
    );
    expect(Object.keys(attentionSchema.parse(base).recommendation!)).toEqual([
      'activity',
      'radarStatus',
      'reasons',
    ]);
  });

  it('upcoming holds at most the hero maximum', () => {
    const five = Array(HERO_MAX_ACTIVITIES).fill(item);
    expect(attentionSchema.safeParse({ ...base, upcoming: five }).success).toBe(true);
    expect(attentionSchema.safeParse({ ...base, upcoming: [...five, item] }).success).toBe(false);
  });
});

describe('nearestDeadlines: what the Home hero walks through', () => {
  it('soonest deadline first, whatever the priority (the first one is the one due first)', () => {
    const late = act(5 * DAY, 'HIGH');
    const soon = act(2 * HOUR, 'LOW');
    const mid = act(2 * DAY, 'MEDIUM');
    expect(nearestDeadlines([late, soon, mid], NOW).map((c) => c.activity.id)).toEqual([
      soon.id,
      mid.id,
      late.id,
    ]);
  });

  it('a recent overdue one is the soonest of all; one forgotten for over a week is left out', () => {
    const recent = act(-2 * DAY);
    const stale = act(-ATTENTION_STALE_OVERDUE_MS - HOUR);
    const next = act(HOUR);
    expect(nearestDeadlines([next, stale, recent], NOW).map((c) => c.activity.id)).toEqual([
      recent.id,
      next.id,
    ]);
  });

  it('finished activities never take part', () => {
    const done = act(HOUR, 'MEDIUM', 'COMPLETED');
    const open = act(2 * HOUR);
    expect(nearestDeadlines([done, open], NOW).map((c) => c.activity.id)).toEqual([open.id]);
  });

  it('at most five, and the same order every time (ties: older first, then id)', () => {
    const items = Array.from({ length: 9 }, (_, i) => act((i % 3) * HOUR + HOUR));
    const once = nearestDeadlines(items, NOW).map((c) => c.activity.id);
    expect(once).toHaveLength(HERO_MAX_ACTIVITIES);
    expect(nearestDeadlines([...items].reverse(), NOW).map((c) => c.activity.id)).toEqual(once);
  });

  it('nothing open: empty (and the hero falls back to the recommendation)', () => {
    expect(nearestDeadlines([], NOW)).toEqual([]);
    expect(nearestDeadlines([act(-ATTENTION_STALE_OVERDUE_MS - DAY)], NOW)).toEqual([]);
  });
});
