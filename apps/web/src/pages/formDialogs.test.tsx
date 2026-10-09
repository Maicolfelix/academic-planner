import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SUBJECT_COLOR_VALUES, type Activity, type Subject } from '@planner/core';
import { ActivityFormDialog } from './activities/ActivityFormDialog';
import { DeleteActivityDialog } from './activities/DeleteActivityDialog';
import { DeleteBlockDialog } from './calendar/DeleteBlockDialog';
import { ReminderSection } from './reminders/ReminderSection';
import { DeleteSubjectDialog } from './subjects/DeleteSubjectDialog';
import { SubjectFormDialog } from './subjects/SubjectFormDialog';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );

const subjects = [
  { id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41', name: 'Redes', color: '#3B82F6' },
  { id: '2d9f7a11-5c3e-4b8a-9d10-6a7b8c9d0e12', name: 'Bases', color: '#F97316' },
] as Subject[];

const activity = (over: Partial<Activity> = {}) =>
  ({
    id: '0b9e5c1a-7d3f-4c1e-9a52-3f1d2c4b6a70',
    subjectId: subjects[0]!.id,
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

const activityForm = (a?: Activity) =>
  wrap(
    <ActivityFormDialog
      subjects={subjects}
      activity={a}
      timeZone="America/Bogota"
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

const at = (html: string, text: string) => html.indexOf(text);

describe('Activity form', () => {
  const create = activityForm();

  it('puts the quick path first (title, subject, date) and the rest behind "Más opciones", closed', () => {
    const order = [
      at(create, 'for="activity-title"'),
      at(create, 'for="activity-subject"'),
      at(create, 'for="activity-date"'),
      at(create, 'Más opciones'),
      at(create, 'for="activity-time"'),
      at(create, 'for="activity-type"'),
      at(create, 'for="activity-priority"'),
      at(create, 'for="activity-description"'),
    ];
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(create).toMatch(/<details[^>]*group/);
    expect(create).not.toMatch(/<details[^>]*\sopen/);
    expect(create).not.toContain('for="activity-status"'); // a new one always starts Pendiente
    expect(create).not.toContain('Recordatorios'); // reminders only exist once the activity does
  });

  it('keeps the native controls: a date and a time picker, selects and a textarea', () => {
    expect(create).toMatch(/<input[^>]*id="activity-date"[^>]*type="date"/);
    expect(create).toMatch(/<input[^>]*id="activity-time"[^>]*type="time"/);
    expect(create.match(/<select/g)).toHaveLength(3); // subject, type, priority
    expect(create).toContain('<textarea');
  });

  it('ends with Cancelar BEFORE the primary action, in the shared footer', () => {
    expect(at(create, '>Cancelar<')).toBeLessThan(at(create, '>Agregar<'));
    expect(create).toContain('border-t border-border/60'); // FormActions
  });

  it('editing adds the state next to the date, keeps the same labels and shows the reminders as part of the form', () => {
    const edit = activityForm(activity());
    expect(edit).toContain('for="activity-status"');
    expect(edit).toContain('Guardar cambios');
    expect(edit).toContain('aria-labelledby="reminders-heading"');
    // the state and the date share a row from 640 px
    expect(edit).toMatch(
      /grid gap-4 sm:grid-cols-2[^"]*"[^>]*><div class="flex min-w-0 flex-col gap-1\.5"><label for="activity-date"/,
    );
  });

  it('opens "Más opciones" by itself when the activity already uses them', () => {
    expect(activityForm(activity({ description: 'Algo' }))).toMatch(/<details[^>]*\sopen=""/);
    expect(activityForm(activity({ type: 'EXAM' }))).toMatch(/<details[^>]*\sopen=""/);
  });
});

describe('Subject form', () => {
  const html = (s?: Subject) =>
    wrap(<SubjectFormDialog periodId="p" subject={s} onClose={() => {}} onSaved={() => {}} />);
  const create = html();

  it('shows the tile of the card live (color and letters) as decoration, beside the name', () => {
    expect(create).toMatch(
      /<span aria-hidden="true" data-subject-preview="true" style="background-color:#[0-9A-Fa-f]{6};color:#[0-9a-f]{6}"/,
    );
    const edit = html({ ...subjects[0]!, professor: null, description: null } as Subject);
    expect(edit).toMatch(
      /data-subject-preview="true" style="background-color:#3B82F6;color:#ffffff"[^>]*>RE<\/span>/,
    );
  });

  it('is a closed palette of real radio buttons, each with its color NAME, one checked, and visible focus and selection', () => {
    expect(create.match(/type="radio"/g)).toHaveLength(SUBJECT_COLOR_VALUES.length);
    expect(create.match(/ checked=""/g)).toHaveLength(1);
    expect(create).toContain('peer-checked:ring-2');
    expect(create).toContain('peer-focus-visible:outline-accent');
    // every swatch is a label that ends with the NAME of its color, for a screen reader
    const named = create.match(
      /type="radio"[^>]*>[\s\S]*?<span class="sr-only">[^<]+<\/span><\/label>/g,
    );
    expect(named).toHaveLength(SUBJECT_COLOR_VALUES.length);
    expect(create).toMatch(/<legend[^>]*>Color<\/legend>/);
  });

  it('hides the professor and the description behind its disclosure, open when there is something in them', () => {
    expect(create).toContain('Más opciones (profesor y descripción)');
    expect(create).not.toMatch(/<details[^>]*\sopen/);
    expect(html({ ...subjects[0]!, professor: 'Carlos', description: null } as Subject)).toMatch(
      /<details[^>]*\sopen=""/,
    );
  });
});

describe('reminders', () => {
  const html = (a: Activity) => wrap(<ReminderSection activity={a} timeZone="America/Bogota" />);

  it('is a soft section of the form, with its title and the way to add one beside it', () => {
    const out = html(activity());
    expect(out).toContain('aria-labelledby="reminders-heading"');
    expect(out).toContain('bg-secondary/40');
    expect(out).toContain('+ Agregar recordatorio');
    expect(at(out, 'Recordatorios</h3>')).toBeLessThan(at(out, '+ Agregar recordatorio'));
  });

  it('offers nothing to add for a finished activity', () => {
    expect(html(activity({ status: 'COMPLETED' }))).not.toContain('+ Agregar recordatorio');
  });
});

describe('delete confirmations', () => {
  const dialogs = [
    wrap(<DeleteActivityDialog activity={activity()} onClose={() => {}} onDeleted={() => {}} />),
    wrap(<DeleteSubjectDialog subject={subjects[0]!} onClose={() => {}} onDeleted={() => {}} />),
    wrap(
      <DeleteBlockDialog
        block={{ id: 'b', type: 'CLASS', title: 'Clase', recurrence: null } as never}
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    ),
  ];

  it('all ask the same way: Cancelar first (the safe, default choice), then a danger Eliminar', () => {
    for (const out of dialogs) {
      expect(at(out, '>Cancelar<')).toBeGreaterThan(-1);
      expect(at(out, '>Cancelar<')).toBeLessThan(at(out, '>Eliminar<'));
      expect(out).toMatch(/<button[^>]*bg-danger[^>]*>Eliminar<\/button>/);
      expect(out).toContain('text-foreground'); // a readable body
    }
  });
});

describe('the forms are off the old palette', () => {
  const files = [
    'components/FormField.tsx',
    'components/SelectField.tsx',
    'components/Modal.tsx',
    'components/ui/form.tsx',
    'components/ui/fieldStyles.ts',
    'pages/activities/ActivityFormDialog.tsx',
    'pages/activities/DeleteActivityDialog.tsx',
    'pages/subjects/SubjectFormDialog.tsx',
    'pages/subjects/DeleteSubjectDialog.tsx',
    'pages/calendar/BlockFormDialog.tsx',
    'pages/calendar/DeleteBlockDialog.tsx',
    'pages/reminders/ReminderSection.tsx',
  ];

  it('has no slate, red, amber or green literal left (tokens only)', () => {
    const literal =
      /\b(?:text|bg|border|outline|ring|fill|stroke|from|to|via|divide|placeholder|shadow)-(?:slate|red|amber|green|yellow|orange)-\d+/;
    for (const f of files) {
      const code = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      expect(literal.exec(code)?.[0], f).toBeUndefined();
    }
  });
});
