import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RADAR_LABELS, RADAR_STATUSES } from '@planner/core';
import { Suggestion } from './attention/AttentionCard';
import { NextDueCard } from './dashboard/NextDueCard';
import { ProgressCard } from './dashboard/ProgressCard';
import { SummaryTiles } from './dashboard/SummaryTiles';
import { RadarDot } from './radar/RadarDot';

const html = (node: ReactElement) =>
  renderToStaticMarkup(<StaticRouter location="/dashboard">{node}</StaticRouter>);

const NOW = new Date('2026-10-08T15:00:00.000Z');
const TZ = 'America/Bogota';
const activity = (over: Record<string, unknown> = {}) => ({
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
  subject: {
    id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
    name: 'Redes de Computadores',
    color: '#3B82F6',
  },
  ...over,
});

describe('the hero: "¿Qué hago ahora?"', () => {
  const hero = (status: 'OVERDUE' | 'IMMEDIATE' | 'UPCOMING' | 'PLANNABLE' | 'UNDER_CONTROL') =>
    html(
      <Suggestion
        item={{
          activity: activity(),
          radarStatus: status,
          reasons: ['Vence en menos de 24 horas.'],
        }}
        timeZone={TZ}
        now={NOW}
      />,
    );

  it('is one article named by the activity, with its subject, deadline, reasons and a labelled link', () => {
    const out = hero('IMMEDIATE');
    expect(out.match(/<article/g)).toHaveLength(1);
    expect(out).toContain('aria-labelledby="attention-activity"');
    expect(out).toContain('id="attention-activity"');
    expect(out).toContain('Parcial de Redes');
    expect(out).toContain('Redes de Computadores');
    expect(out).toContain('¿Por qué esta?');
    expect(out).toContain('<li>Vence en menos de 24 horas.</li>');
    expect(out).toContain('aria-label="Ver actividad: Parcial de Redes"');
    expect(out).toContain('href="/activities?edit=0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70"');
  });

  it.each(RADAR_STATUSES)('%s says its state in words (the mark is decoration)', (status) => {
    const out = hero(status);
    expect(out).toContain(RADAR_LABELS[status]);
    expect(out).toMatch(/aria-hidden="true"[^>]*class="[^"]*rounded-full/); // the dot
  });

  it('keeps the calm intro of every state (it orients, it does not alarm)', () => {
    expect(hero('IMMEDIATE')).toContain('Actividad que requiere mayor atención.');
    expect(hero('OVERDUE')).toContain('Tienes actividades vencidas.');
    expect(hero('UNDER_CONTROL')).toContain('Todo está bajo control.');
  });

  it('its link has a white focus ring: the page ring would vanish on the deep surface', () => {
    expect(hero('IMMEDIATE')).toContain('focus-visible:outline-white');
  });
});

describe('the Radar mark', () => {
  it('is decoration with no text of its own', () => {
    const out = renderToStaticMarkup(<RadarDot status="OVERDUE" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out.replaceAll(/<[^>]+>/g, '')).toBe('');
  });
});

describe('status counters', () => {
  const summary = { total: 8, pending: 3, inProgress: 1, completed: 2, overdue: 2 };

  it('are four links to the matching filtered lists, each with its label as text', () => {
    const out = html(<SummaryTiles summary={summary} />);
    for (const [label, href] of [
      ['Pendientes', '/activities?status=PENDING'],
      ['En proceso', '/activities?status=IN_PROGRESS'],
      ['Finalizadas', '/activities?status=COMPLETED'],
      ['Vencidas', '/activities?overdue=true'],
    ]) {
      expect(out).toContain(label);
      expect(out).toContain(`href="${href}"`);
    }
    expect(out).toContain('aria-labelledby="summary-title"');
  });

  it('only "Vencidas" is flagged, and only when there are some (and it is still text)', () => {
    expect(html(<SummaryTiles summary={summary} />).match(/bg-danger-soft/g)).toHaveLength(1);
    expect(html(<SummaryTiles summary={{ ...summary, overdue: 0 }} />)).not.toContain(
      'bg-danger-soft',
    );
  });
});

describe('progress', () => {
  const out = html(<ProgressCard progress={{ percent: 67, completed: 2, total: 3 }} />);

  it('is a real progressbar with its value and a text equivalent', () => {
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="67"');
    expect(out).toContain('aria-valuemin="0"');
    expect(out).toContain('aria-valuemax="100"');
    expect(out).toContain('aria-valuetext="67%, 2 de 3 actividades finalizadas"');
    expect(out).toContain('67%');
    expect(out).toContain('2 de 3 actividades finalizadas');
  });

  it('fills to its value (width) and animates only the fill, from a transform', () => {
    expect(out).toContain('width:67%');
    expect(out).toContain('animate-fill');
    expect(out).toContain('origin-left');
  });

  it('keeps the honest note about what it measures and the link to the detail', () => {
    expect(out).toContain('Mide solo las actividades que has registrado en este periodo.');
    expect(out).toContain('href="/progress"');
  });
});

describe('next delivery', () => {
  const next = activity({ title: 'Entrega final', dueAt: '2026-10-17T04:59:00.000Z' }) as never;

  it('says title, subject and how far away it is, as a card or as one quiet line', () => {
    for (const quiet of [false, true]) {
      const out = html(<NextDueCard activity={next} timeZone={TZ} now={NOW} quiet={quiet} />);
      expect(out).toContain('Próxima entrega');
      expect(out).toContain('Entrega final');
      expect(out).toContain('Redes de Computadores');
      expect(out).toMatch(/Vence en \d+ días/);
      expect(out).toContain('aria-labelledby="next-due-title"');
    }
  });

  it('the quiet line is not a second card (the hero already shows that activity)', () => {
    const quiet = html(<NextDueCard activity={next} timeZone={TZ} now={NOW} quiet />);
    const card = html(<NextDueCard activity={next} timeZone={TZ} now={NOW} />);
    expect(quiet).not.toContain('shadow-card');
    expect(card).toContain('shadow-card');
  });

  it('without an activity it says so, and "quiet" changes nothing', () => {
    const out = html(<NextDueCard activity={null} timeZone={TZ} now={NOW} quiet />);
    expect(out).toContain('No tienes entregas próximas.');
  });
});

describe('motion (index.css)', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

  it('defines the entrance and the fill with the shared duration and easing tokens', () => {
    expect(css).toMatch(
      /--animate-rise:\s*rise var\(--duration-normal\) var\(--ease-enter\) backwards/,
    );
    expect(css).toMatch(
      /--animate-fill:\s*fill var\(--duration-slow\) var\(--ease-enter\) backwards/,
    );
    expect(css).toMatch(
      /--animate-pop:\s*pop var\(--duration-normal\) var\(--ease-spring\) backwards/,
    );
  });

  it('a finished animation never pins a hover or press transform: fill mode is backwards (the glint excepted)', () => {
    for (const name of ['rise', 'pop', 'fill', 'beacon', 'complete']) {
      expect(css, name).toMatch(new RegExp(`--animate-${name}:[^;]*backwards;`));
    }
    expect(css).toMatch(/--animate-glint:[^;]*both;/);
  });

  it('with reduced motion nothing waits and nothing moves: delays and durations collapse', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';
    expect(block).toContain('animation-duration: 0.01ms !important');
    expect(block).toContain('transition-duration: 0.01ms !important');
    expect(block).toContain('animation-delay: 0s !important');
  });

  /** The properties a keyframes block animates. */
  const animated = (name: string) => {
    const start = css.indexOf(`@keyframes ${name} {`);
    const next = css.indexOf('@keyframes', start + 1);
    const layer = css.indexOf('@layer base', start);
    // up to whichever comes first: the next keyframes block or the end of the theme (a later plain @keyframes must not
    // drag the whole base layer into the slice)
    const end = Math.min(...[next, layer].filter((i) => i !== -1));
    return new Set([...css.slice(start, end).matchAll(/([a-z-]+):/g)].map((m) => m[1]));
  };

  it('the entrance, pop, glint and fill move only transform and opacity (no layout property)', () => {
    for (const name of ['rise', 'pop', 'glint', 'fill']) {
      const props = animated(name);
      expect(
        [...props].filter((p) => p !== 'opacity' && p !== 'transform'),
        name,
      ).toEqual([]);
      expect(props.size, name).toBeGreaterThan(0);
    }
    expect(animated('fill').has('transform')).toBe(true);
  });

  it('loops are either the loading placeholder or AMBIENT (slow, discreet), and reduced motion stops loops', () => {
    const loops = [...css.matchAll(/--animate-([a-z-]+):[^;]*infinite[^;]*;/g)].map((m) => m[1]);
    // `breathe` is the loading placeholder; the rest are the ambient category (documented in ux-accessibility.md)
    expect(loops.sort()).toEqual([
      'breathe',
      'drift',
      'drift-slow',
      'halo',
      'node',
      'orbit',
      'scan',
    ]);
    const block = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';
    expect(block).toContain('animation-iteration-count: 1 !important');
  });

  it('every ambient loop is only ever used as motion-safe (it never starts under reduced motion)', () => {
    const sources = [
      'pages/attention/AttentionCard.tsx',
      'pages/radar/RadarDot.tsx',
      'pages/radar/RadarCard.tsx',
      'components/ui/EmptyState.tsx',
    ];
    for (const file of sources) {
      const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const used = [
        ...code.matchAll(/(motion-safe:)?animate-(drift-slow|drift|halo|scan|node|orbit)\b/g),
      ];
      expect(used.length, file).toBeGreaterThan(0);
      for (const [match, safe] of used) expect(safe, `${file}: ${match}`).toBe('motion-safe:');
    }
  });
});
