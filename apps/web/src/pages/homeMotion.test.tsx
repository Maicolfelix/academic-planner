import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RADAR_STATUSES } from '@planner/core';
import { Card } from '../components/ui/Card';
import { Suggestion } from './attention/AttentionCard';
import { ambientTone } from './dashboard/AmbientTone';
import { HomeSkeleton } from './dashboard/HomeSkeleton';
import { ProgressCard } from './dashboard/ProgressCard';
import { SummaryTiles } from './dashboard/SummaryTiles';
import { RadarGlance } from './radar/RadarCard';
import { AMBIENT_PERIOD, RadarDot } from './radar/RadarDot';

const html = (node: ReactElement) =>
  renderToStaticMarkup(<StaticRouter location="/dashboard">{node}</StaticRouter>);

const activity = {
  id: '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70',
  subjectId: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  title: 'Parcial de Redes',
  description: null,
  type: 'EXAM' as const,
  priority: 'HIGH' as const,
  status: 'PENDING' as const,
  dueAt: '2026-10-09T13:30:00.000Z',
  hasTime: true,
  completedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  subject: { id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41', name: 'Redes', color: '#3B82F6' },
};
const hero = (status: (typeof RADAR_STATUSES)[number]) =>
  html(
    <Suggestion
      item={{ activity, radarStatus: status, reasons: ['Un motivo.'] }}
      timeZone="America/Bogota"
      now={new Date('2026-10-08T15:00:00.000Z')}
    />,
  );

describe('hero personality', () => {
  it('every state has a glow of its own hue', () => {
    const halos = RADAR_STATUSES.map((s) => /\[--halo:[^\]]+\]/.exec(hero(s))?.[0]);
    expect(halos.every(Boolean)).toBe(true);
    expect(new Set(halos).size, 'danger (x2), info, warning and success').toBe(4);
  });

  it('reflects the state: pressing ones keep the deep indigo, planning and under-control ones drift toward teal', () => {
    for (const s of ['OVERDUE', 'IMMEDIATE', 'UPCOMING'] as const)
      expect(hero(s), s).toContain('bg-(image:--gradient-hero)');
    for (const s of ['PLANNABLE', 'UNDER_CONTROL'] as const)
      expect(hero(s), s).toContain('bg-(image:--gradient-hero-calm)');
  });

  it('only the two states that ask for action send a one-time ripple (every state breathes its own slow ring)', () => {
    for (const s of RADAR_STATUSES) {
      const rippled = hero(s).includes('animate-beacon');
      expect(rippled, s).toBe(s === 'OVERDUE' || s === 'IMMEDIATE');
      expect(hero(s), s).toContain('motion-safe:animate-halo');
    }
    // nothing loops without motion being welcome, and no hero text ever moves
    expect(hero('OVERDUE')).not.toMatch(/animate-(breathe|pulse|spin|ping|bounce)/);
  });

  it('its decorations are hidden from assistive tech, cannot catch a tap and sit behind the text', () => {
    const out = hero('IMMEDIATE');
    const spans = [
      ...out.matchAll(/<span aria-hidden="true" class="([^"]*pointer-events-none[^"]*)"/g),
    ];
    expect(spans, 'orb, grid and ring').toHaveLength(3);
    for (const [, classes] of spans) expect(classes).toContain('-z-10');
    // the timeline rail is decoration too, and it sits in the flow (beside the button), never over the text
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"[^>]*pointer-events-none/);
    expect(out).not.toMatch(/<svg[^>]*-z-10/);
  });

  it('its light drifts and its current node breathes only with motion welcome, and the orb is calmer when nothing presses', () => {
    const out = hero('IMMEDIATE');
    expect(out).toContain('motion-safe:animate-drift');
    expect(out).toContain('motion-safe:animate-node');
    expect(out).not.toMatch(/(^|[^:])animate-(drift|node)/); // never without the motion-safe: prefix
    expect(hero('UNDER_CONTROL')).toContain('opacity-70');
    expect(hero('IMMEDIATE')).not.toContain('opacity-70');
  });

  it('the rail lights the node of the current state (five nodes, one of them current)', () => {
    for (const [i, status] of RADAR_STATUSES.entries()) {
      const out = hero(status);
      const lit = [
        ...out.matchAll(/<circle cx="(\d+)" cy="11" r="4" fill="white" fill-opacity="1"/g),
      ];
      expect(lit, status).toHaveLength(1);
      expect(Number(lit[0]![1]), status).toBe(6 + i * 21);
    }
  });

  it('the parts enter one after another within a quarter of a second, and the arrow is decoration', () => {
    const out = hero('IMMEDIATE');
    const delays = [...out.matchAll(/\[animation-delay:(\d+)ms\]/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([60, 110, 150, 190, 260]);
    expect(out).toMatch(
      /<span aria-hidden="true" class="[^"]*group-hover:translate-x-0.5[^"]*">→<\/span>/,
    );
  });
});

describe('Radar mark', () => {
  it('has a halo of its own color and grows inside a group; the beacon is opt-in', () => {
    const dot = renderToStaticMarkup(<RadarDot status="UPCOMING" />);
    expect(dot).toContain('[--halo:');
    expect(dot).toContain('shadow-[0_0_0_5px_var(--halo)]');
    expect(dot).toContain('group-hover:scale-125');
    expect(dot).not.toContain('animate-beacon');
    expect(renderToStaticMarkup(<RadarDot status="UPCOMING" beacon />)).toContain('animate-beacon');
  });

  it('breathes a ring now and then only when asked, out of step with its neighbours, never under reduced motion', () => {
    expect(renderToStaticMarkup(<RadarDot status="OVERDUE" />)).not.toContain('animate-halo');
    const a = renderToStaticMarkup(<RadarDot status="UPCOMING" ambient={0} />);
    const b = renderToStaticMarkup(<RadarDot status="UPCOMING" ambient={1} />);
    expect(a).toContain('motion-safe:animate-halo');
    const delay = (x: string) => /animation-delay:([\d.]+)s/.exec(x)?.[1];
    expect(delay(a)).not.toBe(delay(b));
    expect(a).toContain(`animation-duration:${AMBIENT_PERIOD.UPCOMING}s`);
  });

  it('the graver the state, the closer its rhythm (and every cycle is at least four seconds)', () => {
    const periods = RADAR_STATUSES.map((s) => AMBIENT_PERIOD[s]);
    expect(periods).toEqual([...periods].sort((x, y) => x - y));
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(4);
  });
});

describe('Radar card', () => {
  const summary = { overdue: 2, immediate: 0, upcoming: 1, plannable: 0, underControl: 3 } as never;
  const out = html(<RadarGlance summary={summary} />);

  it('keeps five links, each with its name and its number in text', () => {
    expect(out.match(/<li /g)).toHaveLength(5);
    expect(out.match(/<a /g)).toHaveLength(5);
    for (const label of [
      'Vencidas',
      'Atención inmediata',
      'Próximas',
      'Planificables',
      'Bajo control',
    ])
      expect(out).toContain(label);
    expect(out).toContain('href="/activities?radar=OVERDUE"');
  });

  it('the spectrum is decoration and as wide as the counts: no weight for a zero', () => {
    const strip =
      /<div aria-hidden="true" class="[^"]*animate-fill[^"]*">([\s\S]*?)<\/div>/.exec(out)?.[1] ??
      '';
    const grows = [...strip.matchAll(/flex-grow:(\d+);flex-basis:([^;"]+)/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(grows).toEqual([
      ['2', '0.6rem'],
      ['0', '0'],
      ['1', '0.6rem'],
      ['0', '0'],
      ['3', '0.6rem'],
    ]);
    expect(strip).toContain('motion-safe:animate-scan');
  });

  it('only categories with something to show breathe a ring and take a tint', () => {
    expect(out.match(/motion-safe:animate-halo/g)).toHaveLength(3);
    expect(out.match(/bg-danger-soft/g)).toHaveLength(1); // overdue 2 (immediate is 0: quiet)
    expect(out).toContain('bg-success-soft');
    expect(out).toContain('border-transparent'); // the quiet ones
  });
});

describe('ambient mood', () => {
  const base = { percent: 40, total: 5, overdue: 0 };

  it('is derived only from data the Home already has', () => {
    expect(ambientTone({ ...base, percent: 100 })).toBe('done');
    expect(ambientTone({ ...base, overdue: 1 })).toBe('urgent');
    expect(ambientTone({ ...base, status: 'IMMEDIATE' })).toBe('urgent');
    expect(ambientTone({ ...base, status: 'OVERDUE' })).toBe('urgent');
    expect(ambientTone({ ...base, status: 'PLANNABLE' })).toBe('calm');
    expect(ambientTone({ ...base, status: 'UNDER_CONTROL' })).toBe('calm');
    expect(ambientTone({ ...base, status: 'UPCOMING' })).toBe('neutral');
    expect(ambientTone(base)).toBe('neutral');
  });

  it('"done" needs something to be done: zero activities is not 100 %', () => {
    expect(ambientTone({ percent: 100, total: 0, overdue: 0 })).toBe('neutral');
    expect(ambientTone({ percent: 100, total: 0, overdue: 0, status: 'UNDER_CONTROL' })).toBe(
      'calm',
    );
  });
});

describe('surfaces', () => {
  it('each variant is a different surface of one system (white, soft, tinted, success, accent edge, dashed)', () => {
    const looks = (['solid', 'soft', 'tinted', 'success', 'accent', 'dashed'] as const).map((v) =>
      renderToStaticMarkup(<Card variant={v}>x</Card>),
    );
    expect(new Set(looks).size).toBe(6);
    expect(looks[4]).toContain('before:bg-[linear-gradient'); // the lit edge
    expect(looks[4]).toContain('focus-within:shadow-'); // lights up when you write in it
  });
});

describe('counters', () => {
  const summary = { total: 8, pending: 3, inProgress: 0, completed: 2, overdue: 0 };

  it('are one editorial strip: numerals with their own hue once they have something to show, quiet at zero', () => {
    const out = html(<SummaryTiles summary={summary} />);
    expect(out.match(/<ul /g)).toHaveLength(1);
    expect(out).toContain('text-success-ink'); // finalizadas: 2
    expect(out).toContain('text-primary'); // pendientes: 3
    expect(out).not.toContain('text-info-ink'); // en proceso: 0
    expect(out).not.toContain('bg-danger-soft'); // vencidas: 0
    expect(out).toContain('text-muted-foreground'); // the zero ones, still readable
  });

  it('under each number a thin bar says its share of the total (decoration, and no bar for a zero)', () => {
    const out = html(<SummaryTiles summary={summary} />);
    const widths = [...out.matchAll(/animate-fill rounded-full [^"]*" style="width:(\d+)%/g)].map(
      (m) => Number(m[1]),
    );
    expect(widths).toEqual([38, 0, 25, 0]); // 3/8 and 2/8, rounded
    expect(out.match(/<span aria-hidden="true" class="h-0.5/g)).toHaveLength(4);
  });

  it('respond to a touch: a tint on hover and a press scale on every cell', () => {
    const out = html(<SummaryTiles summary={summary} />);
    expect(out.match(/hover:bg-primary\/5/g)).toHaveLength(4);
    expect(out.match(/active:scale-\[0.98\]/g)).toHaveLength(4);
  });
});

describe('progress', () => {
  it('adds a glint only when there is something to glint on', () => {
    expect(html(<ProgressCard progress={{ percent: 40, completed: 2, total: 5 }} />)).toContain(
      'animate-glint',
    );
    expect(html(<ProgressCard progress={{ percent: 0, completed: 0, total: 5 }} />)).not.toContain(
      'animate-glint',
    );
  });

  it('the exact value is in the markup from the first render, not counted up', () => {
    const out = html(<ProgressCard progress={{ percent: 40, completed: 2, total: 5 }} />);
    expect(out).toContain('aria-valuenow="40"');
    expect(out).toContain('40%');
    expect(out).toContain('width:40%');
  });
});

describe('progress ring and done state', () => {
  const at = (percent: number, completed: number, total: number) =>
    html(<ProgressCard progress={{ percent, completed, total }} />);

  it('draws a ring that is decoration, with the same value as the bar and the exact number as text', () => {
    const out = at(40, 2, 5);
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).toContain('stroke-dasharray="40 100"');
    expect(out).toContain('animate-ring');
    expect(out).toContain('40%');
    expect(out).toContain('aria-valuenow="40"');
  });

  it('at zero the ring has no dot (no round cap) and the glint stays out', () => {
    const out = at(0, 0, 5);
    expect(out).toContain('stroke-linecap="butt"');
    expect(out).not.toContain('animate-glint');
  });

  it('only a goal reached takes the done tint (derived from the same number)', () => {
    expect(at(100, 5, 5)).toContain('border-success-line');
    expect(at(99, 4, 5)).not.toContain('border-success-line');
    expect(at(100, 5, 5)).toContain('var(--success),var(--accent)');
  });
});

describe('loading placeholder', () => {
  const out = renderToStaticMarkup(<HomeSkeleton />);

  it('says what is happening once, as text, and hides every block from assistive tech', () => {
    expect(out).toContain('role="status"');
    expect(out).toContain('Cargando tu panel…');
    expect(out).toMatch(/<div aria-hidden="true"/);
    expect(out.replaceAll(/<[^>]+>/g, '')).toBe('Cargando tu panel…');
  });

  it('breathes (the one loading loop) and has the shape of the Home, in two columns on desktop', () => {
    expect(out).toContain('animate-breathe');
    expect(out).toContain('rounded-hero');
    expect(out).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(19rem,25rem)]');
  });
});
