import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SUBJECT_COLOR_VALUES, type Activity, type Subject } from '@planner/core';
import { ActivityFormDialog } from './ActivityFormDialog';
import { decideInlineSubject, InlineSubjectCreator } from './InlineSubjectCreator';

// F1-2a: "Crear asignatura" inline in the activity form. The interactions (open, cancel, create, Enter, focus) are in
// e2e (this layer renders to markup); here are the markup the student gets and the rule behind "Crear y usar".
const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );

const PERIOD = '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70';
const subject = (id: string, name: string, color: string) =>
  ({ id, periodId: PERIOD, name, color }) as Subject;
const redes = subject('7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41', 'Redes de Computadores', '#3B82F6');
const bases = subject('2d9f7a11-5c3e-4b8a-9d10-6a7b8c9d0e12', 'Bases de Datos', '#EF4444');

const form = (subjects: Subject[], activity?: Partial<Activity> & { id: string }) =>
  wrap(
    <ActivityFormDialog
      subjects={subjects}
      activity={activity as Activity | undefined}
      timeZone="America/Bogota"
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

const general = {
  id: '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70',
  subjectId: null,
  title: 'Trámite',
  description: null,
  type: 'TASK',
  priority: 'MEDIUM',
  status: 'PENDING',
  dueAt: '2026-10-20T15:00:00.000Z',
  hasTime: false,
  completedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
} as const;

const button = (out: string, label: string) =>
  new RegExp(`<button[^>]*type="button"[^>]*>${label}</button>`).exec(out)?.[0];

describe('the activity form offers "Crear asignatura" next to "Omitir asignatura"', () => {
  it('normal mode: both are real 44 px buttons under the selector, and nothing is created by opening the form', () => {
    const out = form([redes, bases]);
    for (const label of ['Omitir asignatura', 'Crear asignatura']) {
      const b = button(out, label);
      expect(b, label).toBeDefined();
      expect(b).toContain('min-h-11');
      expect(b).not.toContain('bg-primary');
    }
    expect(out.indexOf('id="activity-subject"')).toBeLessThan(out.indexOf('Omitir asignatura'));
    expect(out.indexOf('Omitir asignatura')).toBeLessThan(out.indexOf('Crear asignatura'));
    expect(out).not.toContain('Nueva asignatura'); // the creator is closed until asked for
  });

  it('the "Sin asignatura" state offers it as well, beside "Elegir asignatura"', () => {
    const out = form([redes, bases], general);
    expect(out).toContain('Sin asignatura');
    expect(button(out, 'Elegir asignatura')).toBeDefined();
    expect(button(out, 'Crear asignatura')).toBeDefined();
    expect(out).not.toContain('Nueva asignatura');
  });

  it('with NO subjects it opens as "Sin asignatura" and "Crear asignatura" is the way forward', () => {
    const out = form([]);
    expect(out).toContain('Sin asignatura');
    expect(out).toContain('Aún no tienes asignaturas.');
    expect(button(out, 'Crear asignatura')).toBeDefined();
    expect(out).not.toContain('Elegir asignatura'); // nothing to choose from yet
  });

  it('the same id belongs to whichever "Crear asignatura" is shown (the focus returns to it on cancel)', () => {
    for (const out of [form([redes]), form([redes], general), form([])]) {
      expect(out.match(/id="activity-subject-create"/g)).toHaveLength(1);
    }
  });

  it('the dialog is ONE form: the creator cannot be a form of its own', () => {
    expect(form([redes]).match(/<form/g)).toHaveLength(1);
  });
});

describe('the inline creator (markup)', () => {
  const creator = wrap(
    <InlineSubjectCreator
      subjects={[redes]}
      periodId={PERIOD}
      onCreated={() => {}}
      onCancel={() => {}}
    />,
  );

  it('is a named group with a labelled name field and the two buttons, in that order, not a form', () => {
    expect(creator).toContain('role="group"');
    expect(creator).toContain('aria-labelledby="inline-subject-title"');
    expect(creator).toContain('Nueva asignatura');
    expect(creator).toMatch(/<label[^>]*for="inline-subject-name"[^>]*>Nombre<\/label>/);
    expect(creator).not.toContain('<form');
    expect(creator.indexOf('Cancelar')).toBeLessThan(creator.indexOf('Crear y usar'));
    for (const label of ['Cancelar', 'Crear y usar']) {
      const b = button(creator, label);
      expect(b, label).toBeDefined();
      expect(b).toContain('min-h-11');
    }
  });

  it('asks for nothing else (no color, professor or description) and uses the design tokens only', () => {
    expect(creator.match(/<input/g)).toHaveLength(1);
    expect(creator).not.toMatch(/slate-|red-\d|amber-|green-|#[0-9A-Fa-f]{6}/);
  });
});

describe('what "Crear y usar" means (decideInlineSubject)', () => {
  it('a new, valid name creates a subject of the current period with the first unused palette color', () => {
    const d = decideInlineSubject('  Ciberseguridad  ', [redes, bases], PERIOD);
    expect(d.kind).toBe('CREATE');
    if (d.kind !== 'CREATE') return;
    expect(d.input).toMatchObject({ periodId: PERIOD, name: 'Ciberseguridad' });
    expect([redes.color, bases.color]).not.toContain(d.input.color);
    expect(SUBJECT_COLOR_VALUES).toContain(d.input.color);
  });

  it('a name the student already has selects THAT subject and creates nothing, ignoring case, accents and spaces', () => {
    for (const typed of ['redes de computadores', '  REDES  DE  COMPUTADORES ', 'bases de datos']) {
      const d = decideInlineSubject(typed, [redes, bases], PERIOD);
      expect(d.kind, typed).toBe('EXISTING');
    }
    const d = decideInlineSubject('Bases de Datos', [redes, bases], PERIOD);
    expect(d.kind === 'EXISTING' && d.subject.id).toBe(bases.id);
    expect(decideInlineSubject('Redes', [redes, bases], PERIOD).kind).toBe('CREATE'); // a prefix is not the same name
  });

  it('an empty or too long name is refused on the name field, with words', () => {
    for (const bad of ['', '   ', 'x'.repeat(200)]) {
      const d = decideInlineSubject(bad, [redes], PERIOD);
      expect(d.kind, bad).toBe('INVALID');
      if (d.kind === 'INVALID') {
        expect(d.field).toBe('name');
        expect(d.message.length).toBeGreaterThan(5);
      }
    }
  });

  it('without a period nothing is sent', () => {
    const d = decideInlineSubject('Ciberseguridad', [], undefined);
    expect(d).toMatchObject({ kind: 'INVALID', field: 'form' });
  });

  it('with no subjects at all it still creates (the first color of the palette)', () => {
    const d = decideInlineSubject('Ciberseguridad', [], PERIOD);
    expect(d.kind === 'CREATE' && d.input.color).toBe(SUBJECT_COLOR_VALUES[0]);
  });
});
