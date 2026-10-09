import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  RADAR_STATUSES,
  type Activity,
  type ActivityStatus,
  type RadarStatus,
  type Subject,
} from '@planner/core';
import { RadarBadge } from '../radar/RadarBadge';
import { ActivityCard } from './ActivityCard';
import { ActivityFilters } from './ActivityFilters';

const NOW = new Date('2026-10-08T15:00:00.000Z');

const subject = {
  id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  name: 'Bases de Datos',
  color: '#3B82F6',
} as Subject;

const activity = (over: Partial<Activity> = {}): Activity =>
  ({
    id: '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70',
    subjectId: subject.id,
    title: 'Parcial de Redes',
    description: null,
    type: 'EXAM',
    priority: 'HIGH',
    status: 'PENDING',
    dueAt: '2026-10-09T13:30:00.000Z',
    hasTime: true,
    completedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }) as Activity;

/** `null` renders the card without its subject (an unknown one); the default is the usual subject. */
const card = (a: Activity, withSubject: Subject | null = subject) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ActivityCard
        activity={a}
        subject={withSubject ?? undefined}
        timeZone="America/Bogota"
        now={NOW}
        statusPending={false}
        onStatusChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </QueryClientProvider>,
  );

const at = (html: string, text: string) => html.indexOf(text);

describe('ActivityCard hierarchy', () => {
  const out = card(activity());

  it('reads in order: title, subject, deadline, Radar and priority, type, then the actions', () => {
    const order = [
      at(out, 'Parcial de Redes</h2>'),
      at(out, 'Bases de Datos'),
      at(out, 'Vence en'),
      at(out, 'Atención inmediata'),
      at(out, 'Prioridad '),
      at(out, 'Tipo '),
      at(out, 'Completar</button>'),
    ];
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('has ONE primary action ("Completar") and "Editar" within reach; the rest wait behind a menu', () => {
    // the one primary action is a tonal button (a list of solid dark ones would shout twelve times)
    expect(out.match(/bg-accent-soft text-accent-ink/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Completar Parcial de Redes"');
    expect(out).toContain('aria-label="Editar Parcial de Redes"');
    // closed menu: a real button that says which card it belongs to, and nothing of what is inside it
    expect(out).toContain('aria-label="Más acciones: Parcial de Redes"');
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('role="menu"');
    expect(out).not.toContain('Eliminar');
    expect(out).not.toContain('Añadir al calendario');
  });

  it('the status control is still a native select with its name and its three exact states', () => {
    expect(out).toContain('aria-label="Cambiar estado de Parcial de Redes"');
    const options = [...out.matchAll(/<option value="([A-Z_]+)"[^>]*>([^<]+)<\/option>/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(options).toEqual([
      ['PENDING', 'Pendiente'],
      ['IN_PROGRESS', 'En proceso'],
      ['COMPLETED', 'Finalizada'],
    ]);
    expect(out).toMatch(/<option value="PENDING" selected/);
    expect(out).toContain('appearance-none'); // dressed as the state itself, not the browser's gray box
  });

  it('the state is a symbol AND a word (never color alone)', () => {
    for (const [status, symbol] of [
      ['PENDING', '○'],
      ['IN_PROGRESS', '◐'],
      ['COMPLETED', '✓'],
    ] as [ActivityStatus, string][])
      expect(card(activity({ status })), status).toContain(`>${symbol}</span>`);
  });

  it('the type is quiet metadata (text, not another pill) and the priority keeps its symbol and word', () => {
    expect(out).toMatch(
      /<span class="px-1 text-xs text-muted-foreground"><span class="sr-only">Tipo <\/span>Parcial<\/span>/,
    );
    expect(out).toContain('▲');
  });

  it('every touch target is at least 44 px', () => {
    expect(out.match(/min-h-11/g)!.length).toBeGreaterThanOrEqual(3); // select, Completar, Editar
    expect(out).toContain('size-11'); // the menu trigger
  });
});

describe('a finished activity', () => {
  const out = card(activity({ status: 'COMPLETED', completedAt: '2026-10-07T12:00:00.000Z' }));

  it('rests on a quieter surface, has no primary action and no Radar mark, and keeps its title crossed out', () => {
    expect(out).not.toContain('Completar');
    expect(out).not.toContain('Radar ');
    expect(out).toContain('line-through');
    expect(out).toContain('bg-surface/70'); // the `soft` surface
    expect(out).toContain('aria-label="Editar Parcial de Redes"');
  });
});

describe('state and subject on the card', () => {
  it('only the activities that ask for a second look get a tinted edge', () => {
    // the priority badge has its own danger tone, so look at the card itself (its first tag)
    const edge = (a: Activity) => /^<li class="([^"]*)"/.exec(card(a))![1]!;
    expect(edge(activity({ dueAt: '2026-10-08T20:00:00.000Z' }))).toContain('border-danger-line'); // < 24 h
    expect(edge(activity({ dueAt: '2026-10-01T20:00:00.000Z' }))).toContain('border-danger-line'); // overdue
    expect(edge(activity({ dueAt: '2026-12-20T20:00:00.000Z' }))).not.toContain(
      'border-danger-line',
    );
  });

  it("carries the subject's color as a thin inset rail, a dot and a faint wash, never a slab", () => {
    const out = card(activity());
    expect(out).toContain('background-color:#3B82F6');
    expect(out).toMatch(/absolute inset-y-3 left-0 w-1 rounded-r-full/);
    expect(out).toContain('radial-gradient(130% 70% at 0% 0%, #3B82F61a'); // 10 % of the color
    expect(out).not.toContain('w-2 shrink-0'); // the old 8 px slab
  });

  it('falls back to a neutral color when the subject is not known', () => {
    expect(card(activity(), null)).toContain('#64748B');
  });

  it('a list of cards never loops: no ambient animation lives inside a card', () => {
    expect(card(activity())).not.toMatch(/animate-(halo|scan|node|orbit|drift|breathe|beacon)/);
  });
});

describe('RadarBadge', () => {
  it.each(RADAR_STATUSES)('%s is a dot and a word, never an emoji', (status: RadarStatus) => {
    const out = renderToStaticMarkup(<RadarBadge status={status} />);
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out).toMatch(/<span aria-hidden="true" class="[^"]*rounded-full[^"]*\[--halo:/); // the dot
    expect(out).toContain('<span class="sr-only">Radar </span>');
    expect(out.replaceAll(/<[^>]+>/g, '').length).toBeGreaterThan('Radar '.length);
    expect(out).not.toContain('animate-'); // it can repeat dozens of times in a list
  });

  it('keeps the solid red for what already passed, and soft tones for the rest', () => {
    expect(renderToStaticMarkup(<RadarBadge status="OVERDUE" />)).toContain('bg-danger');
    expect(renderToStaticMarkup(<RadarBadge status="UNDER_CONTROL" />)).toContain(
      'bg-success-soft',
    );
  });
});

describe('ActivityFilters', () => {
  const out = renderToStaticMarkup(
    <StaticRouter location="/activities">
      <ActivityFilters filters={{}} subjects={[subject]} onChange={() => {}} />
    </StaticRouter>,
  );

  it('keeps the states as plain pressed-buttons in a labelled group that scrolls sideways instead of wrapping', () => {
    expect(out).toContain('role="group" aria-label="Estado"');
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(out).toContain('overflow-x-auto');
    expect(out).not.toContain('flex-wrap');
    expect(out.match(/whitespace-nowrap/g)).toHaveLength(5);
  });

  it('gathers the native selects in one soft panel, with their labels, and no <details>', () => {
    for (const label of ['Asignatura', 'Prioridad', 'Tipo', 'Radar'])
      expect(out).toContain(`>${label}</label>`);
    expect(out).toContain('bg-surface/70'); // the soft surface
    expect(out).not.toContain('<details');
  });
});
