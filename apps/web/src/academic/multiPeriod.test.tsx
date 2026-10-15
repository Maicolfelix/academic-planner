import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CurrentPeriodContext, DashboardActivity, Progress, Radar } from '@planner/core';
import { ME_KEY } from '../auth/useAuth';
import { OriginLabel } from '../components/OriginLabel';
import { RadarPage } from '../pages/RadarPage';
import { Suggestion } from '../pages/attention/AttentionCard';
import { DueSection } from '../pages/dashboard/DueSection';
import { PeriodScopeLine } from '../pages/dashboard/PeriodScopeLine';
import { ProgressCard } from '../pages/dashboard/ProgressCard';
import { SummaryTiles } from '../pages/dashboard/SummaryTiles';
import { NextDueCard } from '../pages/dashboard/NextDueCard';
import { ProgressByPeriod } from '../pages/progress/ProgressByPeriod';
import { SubjectProgressList } from '../pages/progress/SubjectProgressList';
import { RADAR_KEY } from '../radar/useRadar';
import { currentPeriodsKey, useOrigins } from './useAcademic';
import { originLabelOf, readsSeveralPeriods, scopeNames } from './origin';

const NOW = new Date('2026-10-05T17:00:00.000Z');
const TZ = 'America/Bogota';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = '2026-10-01T00:00:00.000Z';

const period = (n: number, name: string, studyTrackId: string | null = null) => ({
  id: uuid(100 + n),
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
const ctx = (
  n: number,
  name: string,
  study: { id: number; name: string; isPrimary?: boolean } | null,
): CurrentPeriodContext => ({
  period: period(n, name, study ? uuid(study.id) : null),
  studyTrack: study
    ? {
        id: uuid(study.id),
        name: study.name,
        type: 'UNIVERSITY',
        isPrimary: study.isPrimary ?? false,
      }
    : null,
});
const GENERAL = ctx(1, 'Mi planificación', null);
const MEDICINA = ctx(2, '2026-2', { id: 10, name: 'Medicina', isPrimary: true });
const DIPLOMADO = ctx(3, 'Cohorte oct–dic', { id: 11, name: 'Diplomado en Ciberseguridad' });

const activity = (
  n: number,
  title: string,
  periodId: string,
  subject = 'Materia',
): DashboardActivity => ({
  id: uuid(500 + n),
  periodId,
  subjectId: uuid(600 + n),
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
  subject: { id: uuid(600 + n), name: subject, color: '#3B82F6' },
});
const html = (node: React.ReactElement, client = new QueryClient()) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StaticRouter location="/dashboard">{node}</StaticRouter>
    </QueryClientProvider>,
  );

describe('which label says where an item comes from', () => {
  it('none with ONE current period (every item would carry the same label, or none)', () => {
    expect(originLabelOf([GENERAL], GENERAL.period.id)).toBeNull();
    expect(originLabelOf([MEDICINA], MEDICINA.period.id)).toBeNull();
  });

  it('a general period plus ONE study: the study’s items are labelled (the origin is genuinely ambiguous), the general ones are not', () => {
    expect(originLabelOf([GENERAL, MEDICINA], MEDICINA.period.id)).toBe('Medicina');
    expect(originLabelOf([GENERAL, MEDICINA], GENERAL.period.id)).toBeNull();
  });

  it('the study’s name when two or more studies have a current period (and the general one stays unlabelled)', () => {
    const all = [GENERAL, MEDICINA, DIPLOMADO];
    expect(originLabelOf(all, MEDICINA.period.id)).toBe('Medicina');
    expect(originLabelOf(all, DIPLOMADO.period.id)).toBe('Diplomado en Ciberseguridad');
  });

  it('never for the general period (no "Sin estudio" noise), nor for a period that is not a current one', () => {
    const all = [GENERAL, MEDICINA, DIPLOMADO];
    expect(originLabelOf(all, GENERAL.period.id)).toBeNull();
    expect(originLabelOf(all, uuid(999))).toBeNull(); // a past period
  });

  it('an archived study disappears: with ONE current period left, the label goes away too', () => {
    // the server stops listing the archived study's period, so a single current period is left
    expect(originLabelOf([MEDICINA], MEDICINA.period.id)).toBeNull();
    expect(originLabelOf([GENERAL, MEDICINA, DIPLOMADO], DIPLOMADO.period.id)).toBe(
      'Diplomado en Ciberseguridad',
    );
  });

  it('the summaries say "several" when they read more than one period, and name them (a study, or a general period)', () => {
    expect(readsSeveralPeriods([GENERAL])).toBe(false);
    expect(readsSeveralPeriods([GENERAL, MEDICINA, DIPLOMADO])).toBe(true);
    expect(scopeNames([GENERAL, MEDICINA, DIPLOMADO])).toEqual([
      'Mi planificación',
      'Medicina',
      'Diplomado en Ciberseguridad',
    ]);
  });
});

describe('the label is text, never colour alone, and invisible for a simple account', () => {
  it('draws the name with a hidden "Estudio:" for assistive technology, and nothing without a label', () => {
    const out = renderToStaticMarkup(<OriginLabel label="Medicina" />);
    expect(out).toContain('Medicina');
    expect(out).toContain('Estudio: ');
    expect(out).not.toMatch(/style=|color/i);
    expect(renderToStaticMarkup(<OriginLabel label={null} />)).toBe('');
    expect(renderToStaticMarkup(<OriginLabel label={undefined} />)).toBe('');
  });

  it('the useOrigins lookup maps an activity’s period to its study through the current periods', () => {
    const client = new QueryClient();
    client.setQueryData(currentPeriodsKey, [GENERAL, MEDICINA, DIPLOMADO]);
    function Probe() {
      const originOf = useOrigins();
      return (
        <p>
          {[MEDICINA.period.id, DIPLOMADO.period.id, GENERAL.period.id, undefined]
            .map((id) => originOf(id) ?? '-')
            .join('|')}
        </p>
      );
    }
    expect(html(<Probe />, client)).toContain('Medicina|Diplomado en Ciberseguridad|-|-');
  });
});

describe('the lists and the hero carry the origin only when it is given', () => {
  const items = [
    activity(1, 'Parcial', MEDICINA.period.id, 'Farmacología'),
    activity(2, 'Taller', DIPLOMADO.period.id, 'Redes'),
  ];
  const originOf = (id: string | undefined) =>
    originLabelOf([GENERAL, MEDICINA, DIPLOMADO], id ?? '');

  it('a due list says which study each item is from, in the same line as the subject', () => {
    const out = html(
      <DueSection title="Hoy" items={items} timeZone={TZ} now={NOW} origin={originOf} />,
    );
    expect(out).toContain('Farmacología');
    expect(out).toContain('Medicina');
    expect(out).toContain('Redes');
    expect(out).toContain('Diplomado en Ciberseguridad');
  });

  it('without an origin (a simple account) the markup is exactly what it was', () => {
    const plain = html(<DueSection title="Hoy" items={items} timeZone={TZ} now={NOW} />);
    const none = html(
      <DueSection title="Hoy" items={items} timeZone={TZ} now={NOW} origin={() => null} />,
    );
    expect(none).toBe(plain);
    expect(plain).not.toContain('Estudio:');
  });

  it('the next-due card and the hero name the study too', () => {
    const a = items[0]!;
    expect(html(<NextDueCard activity={a} timeZone={TZ} now={NOW} origin="Medicina" />)).toContain(
      'Farmacología · Medicina',
    );
    expect(
      html(<NextDueCard activity={a} timeZone={TZ} now={NOW} quiet origin="Medicina" />),
    ).toContain('Medicina');
    expect(html(<NextDueCard activity={a} timeZone={TZ} now={NOW} />)).not.toContain('Medicina');
    const hero = html(
      <Suggestion
        item={{ activity: a, radarStatus: 'UPCOMING', reasons: ['Vence pronto.'] }}
        timeZone={TZ}
        now={NOW}
        origin="Medicina"
      />,
    );
    expect(hero).toContain('Farmacología · Medicina');
  });
});

describe('the Home reads every current period and says so', () => {
  it('with several: the line under the greeting names them (a study, or a general period); it is text, not a selector', () => {
    const out = html(
      <PeriodScopeLine period={GENERAL.period} periods={[GENERAL, MEDICINA, DIPLOMADO]} />,
    );
    expect(out).toContain(
      'En tus estudios actuales: Mi planificación · Medicina · Diplomado en Ciberseguridad',
    );
    expect(out).not.toMatch(/<select|<button|role="tab/);
  });

  it('with one period it reads exactly as it always did: the period, with its dates', () => {
    const out = html(<PeriodScopeLine period={GENERAL.period} periods={[GENERAL]} />);
    expect(out).toContain('Mi planificación · ');
    expect(out).toContain('2026');
    expect(out).not.toContain('En tus estudios actuales');
  });

  it('no home period and nothing read: nothing is drawn', () => {
    expect(html(<PeriodScopeLine period={null} periods={[]} />)).toBe('');
    // a secondary study alone: no HOME, but the Home does read it (one period: its name, as before)
    expect(html(<PeriodScopeLine period={null} periods={[DIPLOMADO]} />)).toBe('');
  });

  it('the summary and the progress card stop saying "this period" when several are read, and keep saying it for one', () => {
    const summary = { total: 4, pending: 4, inProgress: 0, completed: 0, overdue: 0 };
    const progress = { completed: 1, total: 4, percent: 25 };
    const several =
      html(<SummaryTiles summary={summary} several />) +
      html(<ProgressCard progress={progress} several />);
    expect(several).toContain('Resumen de tus estudios actuales');
    expect(several).toContain('en tus estudios actuales');
    expect(several).not.toMatch(/Resumen del periodo|en este periodo/);
    const one =
      html(<SummaryTiles summary={summary} />) + html(<ProgressCard progress={progress} />);
    expect(one).toContain('Resumen del periodo');
    expect(one).toContain('en este periodo');
  });

  it('it stays one Home: the page source has no workspace or study selector', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(new URL('../pages/DashboardPage.tsx', import.meta.url), 'utf8');
    expect(page).not.toMatch(/<select|role="tablist"|studyTrackId|Cambiar de estudio/);
    expect(page.match(/<h1/g)).toHaveLength(1);
  });
});

const radarOf = (periods: CurrentPeriodContext[], open: number): Radar => ({
  generatedAt: NOW.toISOString(),
  period: periods[0]?.period ?? null,
  periods,
  summary: { overdue: 0, immediate: open, upcoming: 0, plannable: 0, underControl: 0 },
  groups: {
    overdue: [],
    immediate: Array.from({ length: open }, (_, i) =>
      activity(i + 1, `Tarea ${i + 1}`, (i % 2 ? DIPLOMADO : MEDICINA).period.id),
    ),
    upcoming: [],
    plannable: [],
    underControl: [],
  },
});
const radarPage = (r: Radar, extra: [readonly unknown[], unknown][] = []) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_KEY, {
    id: uuid(1),
    name: 'Ana',
    email: 'a@e.com',
    timezone: TZ,
    createdAt: iso,
  });
  client.setQueryData(RADAR_KEY, r);
  client.setQueryData(currentPeriodsKey, r.periods);
  for (const [k, v] of extra) client.setQueryData(k, v);
  return html(<RadarPage />, client);
};

describe('the Radar page reads every current period', () => {
  it('names what it reads, labels each item with its study, and keeps its own order and words', () => {
    const out = radarPage(radarOf([MEDICINA, DIPLOMADO], 2));
    expect(out).toContain('En tus estudios actuales: Medicina · Diplomado en Ciberseguridad');
    expect(out).toContain('Tarea 1');
    expect(out).toContain('Tarea 2');
    expect(out).toContain('Medicina');
    expect(out).toContain('Diplomado en Ciberseguridad');
  });

  it('the empty state does not say "the current period" when several are read', () => {
    expect(radarPage(radarOf([MEDICINA, DIPLOMADO], 0))).toContain('en tus estudios actuales');
    expect(radarPage(radarOf([GENERAL], 0))).toContain('en el periodo actual');
  });

  it('one study: the page reads exactly as before, with its period name and no labels', () => {
    const out = radarPage(radarOf([MEDICINA], 2));
    expect(out).toContain('2026-2');
    expect(out).not.toContain('En tus estudios actuales');
    expect(out).not.toContain('Estudio:');
  });
});

describe('the progress by study', () => {
  const summary = (total: number, completed: number, overdue = 0) => ({
    total,
    completed,
    pending: total - completed,
    inProgress: 0,
    overdue,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  });
  const byPeriod: Progress['byPeriod'] = [
    { ...GENERAL, general: summary(1, 0) },
    { ...MEDICINA, general: summary(12, 8, 1) },
    { ...DIPLOMADO, general: summary(8, 4) },
  ];

  it('one line per period (a study’s name, or the general period’s own) with its own count, text first', () => {
    const out = html(<ProgressByPeriod byPeriod={byPeriod} />);
    expect(out).toContain('Por periodo');
    expect(out).not.toContain('Por estudio');
    expect(out).toContain('Mi planificación');
    expect(out).toContain('8 de 12 completadas');
    expect(out).toContain('4 de 8 completadas');
    expect(out).toContain('1 vencida');
    expect(out).toContain('role="progressbar"');
  });

  it('a study with no activity says so', () => {
    const out = html(<ProgressByPeriod byPeriod={[{ ...MEDICINA, general: summary(0, 0) }]} />);
    expect(out).toContain('Sin actividades registradas');
  });

  it('the subjects name their study when it is useful', () => {
    const subjects: Progress['subjects'] = [
      {
        id: uuid(1),
        periodId: MEDICINA.period.id,
        name: 'Farmacología',
        color: '#3B82F6',
        ...summary(2, 1),
      },
      {
        id: uuid(2),
        periodId: DIPLOMADO.period.id,
        name: 'Redes',
        color: '#EF4444',
        ...summary(3, 0),
      },
    ];
    const origin = (id: string | undefined) => originLabelOf(byPeriod, id ?? '');
    const out = html(<SubjectProgressList subjects={subjects} origin={origin} />);
    expect(out).toContain('Medicina');
    expect(out).toContain('Diplomado en Ciberseguridad');
    // and nothing changes without an origin
    expect(html(<SubjectProgressList subjects={subjects} />)).not.toContain('Estudio:');
  });
});

describe('the Activity carries its period (read-only) and the web maps it to a study through the periods, never stores one', () => {
  it('no study id is read from an activity anywhere in the production web', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory()
          ? walk(p)
          : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)
            ? [p]
            : [];
      });
    const offenders = walk(root).filter((f) =>
      /activity\.studyTrackId|subject\.studyTrackId|\.studyTrackId\b.*activity/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
