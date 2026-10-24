import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ActivityStatus } from '@planner/core';
import { Suggestion } from './attention/AttentionCard';

const html = (node: ReactElement) =>
  renderToStaticMarkup(<StaticRouter location="/dashboard">{node}</StaticRouter>);

const activity = (status: ActivityStatus) => ({
  id: '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70',
  periodId: '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70',
  subjectId: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  title: 'Parcial de Redes',
  description: null,
  type: 'EXAM' as const,
  priority: 'HIGH' as const,
  status,
  dueAt: '2026-10-09T13:30:00.000Z',
  hasTime: true,
  completedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  subject: { id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41', name: 'Redes', color: '#3B82F6' },
});

const hero = (
  status: ActivityStatus,
  actions?: Partial<NonNullable<Parameters<typeof Suggestion>[0]['actions']>>,
) =>
  html(
    <Suggestion
      item={{ activity: activity(status), radarStatus: 'IMMEDIATE', reasons: ['Un motivo.'] }}
      timeZone="America/Bogota"
      now={new Date('2026-10-08T15:00:00.000Z')}
      actions={
        actions && {
          onComplete: () => {},
          onStart: () => {},
          pending: null,
          busy: false,
          error: null,
          ...actions,
        }
      }
    />,
  );

describe('hero actions', () => {
  it('a pending activity offers Completar, Empezar and the link; an in-progress one has no Empezar', () => {
    const pending = hero('PENDING', {});
    expect(pending).toContain('aria-label="Completar: Parcial de Redes"');
    expect(pending).toContain('aria-label="Empezar: Parcial de Redes"');
    expect(pending).toContain('aria-label="Ver actividad: Parcial de Redes"');
    const started = hero('IN_PROGRESS', {});
    expect(started).toContain('aria-label="Completar: Parcial de Redes"');
    expect(started).not.toContain('Empezar');
  });

  it('without a data layer only the link is offered (no impossible actions)', () => {
    const out = hero('PENDING');
    expect(out).not.toContain('Completar');
    expect(out).not.toContain('Empezar');
    expect(out).toContain('Ver actividad');
  });

  it('while a change is in flight every button waits and the clicked one says so', () => {
    const out = hero('PENDING', { busy: true, pending: 'COMPLETED' });
    expect(out.match(/disabled=""/g)).toHaveLength(2);
    expect(out).toContain('Completando…');
    expect(out).toContain('aria-busy="true"');
  });

  it('a failed change is said in a live alert, never as a success', () => {
    const out = hero('PENDING', { error: 'Sin conexión.' });
    expect(out).toContain('role="alert"');
    expect(out).toContain('No se pudo guardar el cambio: Sin conexión.');
    expect(out).not.toMatch(/completada/i);
    expect(hero('PENDING', {})).not.toContain('role="alert"');
  });

  it('shows no grade or weight line (the attention answer does not carry one) and no order words', () => {
    const text = hero('PENDING', {}).replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/%|nota|debes/i);
  });
});
