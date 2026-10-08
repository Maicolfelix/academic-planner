import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RADAR_STATUSES } from '@planner/core';
import { INTERACTIVE_TILE } from '../components/ui/interactive';
import { Suggestion } from './attention/AttentionCard';
import { HomeSkeleton } from './dashboard/HomeSkeleton';
import { ProgressCard } from './dashboard/ProgressCard';
import { SummaryTiles } from './dashboard/SummaryTiles';
import { RadarDot } from './radar/RadarDot';

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
  it('every state has a glow of its own hue, and the hero uses the one gradient surface', () => {
    const halos = RADAR_STATUSES.map((s) => /\[--halo:[^\]]+\]/.exec(hero(s))?.[0]);
    expect(halos.every(Boolean)).toBe(true);
    expect(new Set(halos).size, 'danger (x2), info, warning and success').toBe(4);
    expect(hero('IMMEDIATE')).toContain('bg-(image:--gradient-hero)');
  });

  it('only the two states that ask for action send a ripple, and only once', () => {
    for (const s of RADAR_STATUSES) {
      const rippled = hero(s).includes('animate-beacon');
      expect(rippled, s).toBe(s === 'OVERDUE' || s === 'IMMEDIATE');
    }
    // one-shot: nothing in the hero loops
    expect(hero('OVERDUE')).not.toMatch(/animate-(breathe|pulse|spin|ping|bounce)/);
  });

  it('its decorations are hidden from assistive tech, cannot catch a tap and sit behind the text', () => {
    const out = hero('IMMEDIATE');
    const decorations = [
      ...out.matchAll(/<span aria-hidden="true" class="([^"]*pointer-events-none[^"]*)"/g),
    ];
    expect(decorations).toHaveLength(2);
    for (const [, classes] of decorations) expect(classes).toContain('-z-10');
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
});

describe('counters', () => {
  const summary = { total: 8, pending: 3, inProgress: 0, completed: 2, overdue: 0 };

  it('take a tint of their own once they have something to show, and stay plain at zero', () => {
    const out = html(<SummaryTiles summary={summary} />);
    expect(out).toContain('bg-success-soft'); // finalizadas: 2
    expect(out).toContain('bg-secondary'); // pendientes: 3
    expect(out).not.toContain('bg-info-soft'); // en proceso: 0
    expect(out).not.toContain('bg-danger-soft'); // vencidas: 0
    expect(out).toContain('text-muted-foreground'); // the zero ones, still readable
  });

  it('lift and respond to a press like every tappable card', () => {
    expect(INTERACTIVE_TILE).toContain('hover:shadow-lift');
    expect(INTERACTIVE_TILE).toContain('active:scale-[0.98]');
    expect(html(<SummaryTiles summary={summary} />)).toContain('hover:shadow-lift');
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

describe('loading placeholder', () => {
  const out = renderToStaticMarkup(<HomeSkeleton />);

  it('says what is happening once, as text, and hides every block from assistive tech', () => {
    expect(out).toContain('role="status"');
    expect(out).toContain('Cargando tu panel…');
    expect(out).toMatch(/<div aria-hidden="true"/);
    expect(out.replaceAll(/<[^>]+>/g, '')).toBe('Cargando tu panel…');
  });

  it('breathes (the one loop) and has the shape of the Home', () => {
    expect(out).toContain('animate-breathe');
    expect(out).toContain('rounded-hero');
  });
});
