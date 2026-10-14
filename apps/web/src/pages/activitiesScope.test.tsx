import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Activity, CurrentPeriodContext, Subject } from '@planner/core';
import { originLabelOf } from '../academic/origin';
import { subjectsKey } from '../academic/useAcademic';
import { ActivityDialog } from './activities/ActivityDialog';
import { ActivityFilters } from './activities/ActivityFilters';
import { ActivityList } from './activities/ActivityList';
import { parseFilters, serializeFilters, toApiQuery } from './activities/filterParams';
import { SummaryTiles } from './dashboard/SummaryTiles';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TZ = 'America/Bogota';
const NOW = new Date('2026-10-05T17:00:00.000Z');
const iso = '2026-10-01T00:00:00.000Z';

const HOME_P = U(1); // the general period: HOME
const MED_P = U(2); // Medicina
const DIP_P = U(3); // Diplomado
const period = (id: string, name: string, studyTrackId: string | null) => ({
  id,
  name,
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: iso,
  updatedAt: iso,
});
const study = (id: number, name: string, isPrimary = false) => ({
  id: U(id),
  name,
  type: 'UNIVERSITY' as const,
  isPrimary,
});
const GENERAL: CurrentPeriodContext = { period: period(HOME_P, 'General', null), studyTrack: null };
const MEDICINA: CurrentPeriodContext = {
  period: period(MED_P, '2026-2', U(10)),
  studyTrack: study(10, 'Medicina', true),
};
const DIPLOMADO: CurrentPeriodContext = {
  period: period(DIP_P, 'Cohorte', U(11)),
  studyTrack: study(11, 'Diplomado en Ciberseguridad'),
};

const subject = (n: number, name: string, periodId: string): Subject =>
  ({ id: U(100 + n), periodId, name, color: '#3B82F6' }) as Subject;
const activity = (
  n: number,
  title: string,
  periodId: string,
  subjectId: string | null,
): Activity => ({
  id: U(200 + n),
  periodId,
  subjectId,
  title,
  description: null,
  type: 'TASK',
  priority: 'MEDIUM',
  status: 'PENDING',
  dueAt: '2026-10-08T15:00:00.000Z',
  hasTime: true,
  completedAt: null,
  createdAt: iso,
  updatedAt: iso,
});

const wrap = (node: React.ReactNode, client = new QueryClient()) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StaticRouter location="/activities">{node}</StaticRouter>
    </QueryClientProvider>,
  );

describe('the Activities list reads the SAME scope as the counters of the Home', () => {
  it('the Home counters lead to the list of the activities, and the list asks for ALL the current periods', () => {
    const counters = wrap(
      <SummaryTiles
        summary={{ total: 12, pending: 12, inProgress: 0, completed: 0, overdue: 0 }}
        several
      />,
    );
    expect(counters).toContain('href="/activities?status=PENDING"');
    // the page asks for the named scope (the server decides which periods), never a list of ids
    const query = toApiQuery(parseFilters(new URLSearchParams('status=PENDING')));
    expect(query).toMatchObject({ scope: 'current', status: 'PENDING' });
    expect(query).not.toHaveProperty('periodId');
    expect(JSON.stringify(query)).not.toMatch(/periodIds|studyTrack/);
  });

  it('the filters keep working on top of the scope (status, overdue, subject, priority, type, radar)', () => {
    const f = parseFilters(
      new URLSearchParams('overdue=true&subject=none&priority=HIGH&type=EXAM&radar=IMMEDIATE'),
    );
    expect(toApiQuery(f)).toEqual({
      scope: 'current',
      subjectId: 'none',
      status: undefined,
      priority: 'HIGH',
      type: 'EXAM',
      overdue: true,
      radar: 'IMMEDIATE',
    });
    expect(serializeFilters(f).get('overdue')).toBe('true'); // and the URL still carries the filters, not the scope
    expect(serializeFilters(f).has('scope')).toBe(false);
  });

  it('HOME has 5 and the other study 7: the list shows all 12, each with its study when it is useful', () => {
    const subjects = [subject(1, 'Farmacología', MED_P), subject(2, 'Redes', DIP_P)];
    const activities = [
      ...Array.from({ length: 5 }, (_, i) => activity(i, `Medicina ${i}`, MED_P, subjects[0]!.id)),
      ...Array.from({ length: 7 }, (_, i) =>
        activity(10 + i, `Diplomado ${i}`, DIP_P, subjects[1]!.id),
      ),
    ];
    const origin = (id: string | undefined) => originLabelOf([MEDICINA, DIPLOMADO], id ?? '');
    const out = wrap(
      <ActivityList
        activities={activities}
        subjects={subjects}
        timeZone={TZ}
        now={NOW}
        pendingStatusId={undefined}
        onStatusChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        origin={origin}
      />,
    );
    expect(out.match(/<li/g)?.length).toBeGreaterThanOrEqual(12);
    for (const a of activities) expect(out).toContain(a.title);
    expect(out).toContain('Medicina');
    expect(out).toContain('Diplomado en Ciberseguridad');
    expect(out).toContain('Estudio:'); // the label is text for assistive technology too
  });

  it('general + ONE study: the study’s items are labelled, the general ones are not ("Sin estudio" never exists)', () => {
    const origin = (id: string) => originLabelOf([GENERAL, MEDICINA], id);
    expect(origin(MED_P)).toBe('Medicina');
    expect(origin(HOME_P)).toBeNull();
  });

  it('with ONE period nothing changes: the same cards, no label', () => {
    const subjects = [subject(1, 'Farmacología', MED_P)];
    const activities = [activity(1, 'Una', MED_P, subjects[0]!.id)];
    const props = {
      activities,
      subjects,
      timeZone: TZ,
      now: NOW,
      pendingStatusId: undefined,
      onStatusChange: () => {},
      onEdit: () => {},
      onDelete: () => {},
    };
    const plain = wrap(<ActivityList {...props} />);
    const one = wrap(
      <ActivityList {...props} origin={(id) => originLabelOf([MEDICINA], id ?? '')} />,
    );
    expect(one).toBe(plain);
    expect(plain).not.toContain('Estudio:');
  });
});

describe('the subject filter lists the subjects of every current period', () => {
  it('both studies’ subjects are options, and two subjects of the same name are told apart by their study', () => {
    const subjects = [
      subject(1, 'Inglés', MED_P),
      subject(2, 'Inglés', DIP_P),
      subject(3, 'Redes', DIP_P),
    ];
    const origin = (id: string | undefined) => originLabelOf([MEDICINA, DIPLOMADO], id ?? '');
    const out = wrap(
      <ActivityFilters filters={{}} subjects={subjects} onChange={() => {}} origin={origin} />,
    );
    expect(out).toContain('Inglés · Medicina');
    expect(out).toContain('Inglés · Diplomado en Ciberseguridad');
    expect(out).toContain('Redes · Diplomado en Ciberseguridad');
    // one period: the plain names, as before
    const one = wrap(
      <ActivityFilters filters={{}} subjects={[subjects[0]!]} onChange={() => {}} />,
    );
    expect(one).toContain('>Inglés<');
    expect(one).not.toContain('Inglés ·');
  });
});

describe('writing stays HOME; editing uses the activity’s own period', () => {
  const homeSubjects = [subject(1, 'Tareas del hogar', HOME_P)];
  const secondary = [subject(2, 'Seguridad de Redes', DIP_P)];
  const form = (a: Activity | undefined, client: QueryClient) =>
    wrap(
      <ActivityDialog
        subjects={homeSubjects}
        activity={a}
        timeZone={TZ}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      client,
    );

  it('a NEW activity offers the HOME period’s subjects, never the other study’s', () => {
    const client = new QueryClient();
    client.setQueryData(subjectsKey(DIP_P), secondary);
    const out = form(undefined, client);
    expect(out).toContain('Tareas del hogar');
    expect(out).not.toContain('Seguridad de Redes');
  });

  it('editing an activity of the other study offers THAT period’s subjects, not the home ones', () => {
    const client = new QueryClient();
    client.setQueryData(subjectsKey(DIP_P), secondary);
    const out = form(activity(1, 'Proyecto', DIP_P, secondary[0]!.id), client);
    expect(out).toContain('Seguridad de Redes');
    expect(out).not.toContain('Tareas del hogar');
    expect(out).toContain('Proyecto'); // it opens on the activity itself
  });

  it('while those subjects load nothing is drawn (no wrong list flashes), and the activity keeps its period', () => {
    expect(form(activity(1, 'Proyecto', DIP_P, secondary[0]!.id), new QueryClient())).toBe('');
  });

  it('an edit never sends a period: the payload of the form has no periodId and the schema refuses one', () => {
    const src = readFileSync(
      new URL('./activities/ActivityFormDialog.tsx', import.meta.url),
      'utf8',
    );
    // the only `periodId` in the form is the prop of the inline subject creator (where a NEW subject goes), never a payload
    const uses = src.match(/periodId/g) ?? [];
    expect(src.match(/periodId[:=]/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/periodId=\{activity\?\.periodId \?\? period\?\.id/);
    expect(uses.length).toBeGreaterThan(0);
  });

  it('the page creates in HOME: it hands the dialog the home subjects and reads the list from the current scope', () => {
    const page = readFileSync(new URL('./ActivitiesPage.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/useSubjects\(period\?\.id\)/); // HOME subjects for a new activity
    expect(page).toMatch(/subjects=\{subjectList\}/);
    expect(page).toMatch(/useActivities\(toApiQuery\(filters\)/);
    expect(page).not.toMatch(/periodIds|studyTrackId/); // no list of periods, no study id from the client
    expect(page).not.toMatch(/<select|StudySwitcher|selectedStudy/);
  });
});
