import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Activity, Subject } from '@planner/core';
import { ActivityCard } from './ActivityCard';
import { ActivityFilters } from './ActivityFilters';
import { ActivityFormDialog } from './ActivityFormDialog';

// F1-1: an activity may have no subject. The words are fixed: "Omitir asignatura" (action), "Sin asignatura" (state),
// "Elegir asignatura" (restore) and "Sin asignatura" (filter). Interactions (omit, restore, the payload) are in e2e.
const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );

const redes = {
  id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  name: 'Redes',
  color: '#3B82F6',
} as Subject;
const bases = {
  id: '2d9f7a11-5c3e-4b8a-9d10-6a7b8c9d0e12',
  name: 'Bases',
  color: '#F97316',
} as Subject;

const activity = (over: Partial<Activity> = {}) =>
  ({
    id: '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70',
    subjectId: redes.id,
    title: 'Parcial 1',
    description: null,
    type: 'TASK',
    priority: 'MEDIUM',
    status: 'PENDING',
    dueAt: '2026-10-20T15:00:00.000Z',
    hasTime: false,
    completedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }) as Activity;

const form = (subjects: Subject[], a?: Activity) =>
  wrap(
    <ActivityFormDialog
      subjects={subjects}
      activity={a}
      timeZone="America/Bogota"
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

describe('the activity form and the subject', () => {
  it('normal mode (there are subjects): the selector, with "Omitir asignatura" under it as a real button', () => {
    const out = form([redes, bases]);
    expect(out).toContain('for="activity-subject"');
    expect(out).toContain('<select id="activity-subject"');
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>Omitir asignatura<\/button>/);
    expect(out).not.toContain('Elegir asignatura');
    expect(out).not.toContain('Sin asignatura'); // never the default when there are subjects
  });

  it('"Omitir asignatura" is a discreet action (a ghost button of 44 px), not a primary one', () => {
    const out = form([redes, bases]);
    const button = /<button[^>]*>Omitir asignatura<\/button>/.exec(out)![0];
    expect(button).toContain('min-h-11');
    expect(button).not.toContain('bg-primary');
  });

  it('an existing activity with a subject opens with its subject, still choosable and omissible', () => {
    const out = form([redes, bases], activity());
    expect(out).toContain('<select id="activity-subject"');
    expect(out).toContain('Omitir asignatura');
    expect(out).not.toContain('Sin asignatura');
  });

  it('an existing GENERAL activity opens as "Sin asignatura" with "Elegir asignatura", and no selector at all', () => {
    const out = form([redes, bases], activity({ subjectId: null }));
    expect(out).toContain('Sin asignatura');
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>Elegir asignatura<\/button>/);
    expect(out).not.toContain('id="activity-subject"'); // no select in the tree: nothing hidden to focus
    expect(out).not.toContain('<select id="activity-subject"');
    expect(out).not.toContain('Omitir asignatura');
    expect(out).not.toContain('role="alert"'); // no error: a general activity is valid
  });

  it('with NO subjects the form opens as "Sin asignatura", says so, and offers nothing to choose', () => {
    const out = form([]);
    expect(out).toContain('Sin asignatura');
    expect(out).toContain('Aún no tienes asignaturas.');
    expect(out).not.toContain('Elegir asignatura');
    expect(out).not.toContain('<select id="activity-subject"');
    expect(out).toContain('Agregar'); // and it can still be saved
  });

  it('keeps its own words out of colour alone: the state is text, the mark is decoration', () => {
    const out = form([redes], activity({ subjectId: null }));
    expect(out).toMatch(/aria-hidden="true"[^>]*background-color:#64748B/);
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-labelledby="activity-subject-label"');
  });
});

describe('the activity card without a subject', () => {
  const card = (a: Activity, subject?: Subject) =>
    wrap(
      <ActivityCard
        activity={a}
        subject={subject}
        timeZone="America/Bogota"
        now={new Date('2026-10-08T15:00:00.000Z')}
        statusPending={false}
        onStatusChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

  it('says "Sin asignatura" in a discreet line with the neutral mark, and no subject colour', () => {
    const out = card(activity({ subjectId: null }));
    expect(out).toContain('Sin asignatura');
    expect(out).toContain('background-color:#64748B');
    expect(out).not.toContain('#3B82F6');
  });

  it('with a subject it shows the subject and never "Sin asignatura"', () => {
    const out = card(activity(), redes);
    expect(out).toContain('Redes');
    expect(out).toContain('background-color:#3B82F6');
    expect(out).not.toContain('Sin asignatura');
  });

  it('a subject that is just not in the list (not loaded) leaves no false "Sin asignatura"', () => {
    expect(card(activity(), undefined)).not.toContain('Sin asignatura');
  });

  it('keeps every action of a subject-bound card (complete, calendar, edit, delete)', () => {
    const out = card(activity({ subjectId: null }));
    expect(out).toContain('Completar');
    expect(out).toContain('Editar');
    expect(out).toContain('Más acciones');
  });
});

describe('the subject filter', () => {
  const filters = (subject?: string) =>
    wrap(<ActivityFilters filters={{ subject }} subjects={[redes, bases]} onChange={() => {}} />);

  it('always offers "Sin asignatura" (value `none`), after the real subjects', () => {
    const out = filters();
    expect(out).toContain('<option value="none"');
    const none = out.indexOf('>Sin asignatura</option>');
    expect(none).toBeGreaterThan(out.indexOf('>Bases</option>'));
    expect(none).toBeGreaterThan(out.indexOf('>Redes</option>'));
  });

  it('is offered even when there are no subjects at all', () => {
    const out = wrap(<ActivityFilters filters={{}} subjects={[]} onChange={() => {}} />);
    expect(out).toContain('>Sin asignatura</option>');
  });

  it('is shown as chosen when the URL says `subject=none`', () => {
    expect(filters('none')).toMatch(/<option value="none"[^>]*selected/);
  });
});
