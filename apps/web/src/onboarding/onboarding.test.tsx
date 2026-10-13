import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AcademicPeriod, OnboardingStatus, PrimaryUse, Profile } from '@planner/core';
import { periodsKey } from '../academic/useAcademic';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PROFILE_KEY } from '../profile/useProfile';
import { USE_OPTIONS, defaultPeriodName, onboardingStep, periodHeading } from './onboardingModel';
import { PeriodStep } from './PeriodStep';
import { PrimaryUseStep } from './PrimaryUseStep';

const QUESTION = '¿Para qué quieres usar Academic Planner?';
const profile = (primaryUse: PrimaryUse | null, onboardingStatus: OnboardingStatus): Profile => ({
  primaryUse,
  programName: null,
  programKey: null,
  onboardingStatus,
});
const period = (isCurrent = true): AcademicPeriod => ({
  id: '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70',
  name: 'P',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

/** The page as the server would render it with these answers already in the cache. */
function page(p: Profile | undefined, periods: AcademicPeriod[] | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (p) client.setQueryData(PROFILE_KEY, p);
  if (periods) client.setQueryData(periodsKey, periods);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StaticRouter location="/onboarding">
        <OnboardingPage />
      </StaticRouter>
    </QueryClientProvider>,
  );
}
const h1 = (html: string) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];

describe('which step the onboarding is on (derived from what the server knows)', () => {
  const step = (use: PrimaryUse | null, status: OnboardingStatus, hasPeriod: boolean) =>
    onboardingStep({ primaryUse: use, onboardingStatus: status }, hasPeriod);

  it('a new account (nothing answered, no period) starts with the question', () => {
    expect(step(null, 'NOT_STARTED', false)).toBe('USE');
  });

  it('after the answer it is the period; after skipping it is also the period (it is required)', () => {
    expect(step('UNIVERSITY_STUDENT', 'IN_PROGRESS', false)).toBe('PERIOD');
    expect(step(null, 'SKIPPED', false)).toBe('PERIOD');
  });

  it('an answer that was saved but whose status says otherwise still continues at the period (no rigid counter)', () => {
    expect(step('PERSONAL', 'NOT_STARTED', false)).toBe('PERIOD');
    expect(step('TEACHER', 'COMPLETED', false)).toBe('PERIOD');
  });

  it('with a period: the question if it is unanswered (even after skipping: skipping never forbids coming back), else nothing', () => {
    expect(step(null, 'NOT_STARTED', true)).toBe('USE');
    expect(step(null, 'SKIPPED', true)).toBe('USE');
    expect(step(null, 'IN_PROGRESS', true)).toBe('USE');
    expect(step('SCHOOL_STUDENT', 'IN_PROGRESS', true)).toBe('DONE');
    expect(step('SCHOOL_STUDENT', 'COMPLETED', true)).toBe('DONE');
  });
});

describe('the words that change with the primary use (only words: the domain is the same)', () => {
  it('has the heading of each use, and a neutral one without an answer', () => {
    expect(periodHeading('UNIVERSITY_STUDENT')).toBe('Tu semestre actual');
    expect(periodHeading('SCHOOL_STUDENT')).toBe('Tu periodo escolar');
    expect(periodHeading('OTHER_STUDENT')).toBe('Tu periodo de estudio');
    expect(periodHeading('TEACHER')).toBe('Tu periodo actual');
    expect(periodHeading('PERSONAL')).toBe('Tu planificación actual');
    expect(periodHeading(null)).toBe('Tu periodo actual');
  });

  it('offers a name (the personal one is its own), never dates', () => {
    expect(defaultPeriodName('PERSONAL')).toBe('Mi planificación');
    expect(defaultPeriodName('UNIVERSITY_STUDENT', new Date('2026-10-12T12:00:00Z'))).toBe(
      'Segundo semestre 2026',
    );
    expect(defaultPeriodName(null, new Date('2026-02-10T12:00:00Z'))).toBe('Primer semestre 2026');
  });
});

describe('step 1: the five options', () => {
  const html = (over: Partial<Parameters<typeof PrimaryUseStep>[0]> = {}) =>
    renderToStaticMarkup(
      <PrimaryUseStep
        selected={null}
        pending={false}
        onPick={() => {}}
        onSkip={() => {}}
        {...over}
      />,
    );

  it('shows the options in order, each with a title and a short description, as real buttons', () => {
    const out = html();
    expect(USE_OPTIONS.map((o) => o.value)).toEqual([
      'UNIVERSITY_STUDENT',
      'SCHOOL_STUDENT',
      'TEACHER',
      'OTHER_STUDENT',
      'PERSONAL',
    ]);
    const buttons = [...out.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(6); // the five options and "Omitir por ahora"
    expect(buttons.every((b) => b.includes('type="button"'))).toBe(true);
    let at = -1;
    for (const o of USE_OPTIONS) {
      const i = out.indexOf(o.title);
      expect(i, o.title).toBeGreaterThan(at);
      at = i;
      expect(out).toContain(o.description);
    }
    // an SVG icon for each (hidden from assistive tech), never an emoji
    expect(out.match(/<svg[^>]*aria-hidden="true"/g)!.length).toBeGreaterThanOrEqual(5);
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out).toContain('Omitir por ahora');
    expect(out).not.toContain('role="alert"');
  });

  it('nothing is chosen until the student chooses: every option is aria-pressed="false"', () => {
    expect(html().match(/aria-pressed="false"/g)).toHaveLength(5);
  });

  it('the chosen one says so with words (not only color) and is pressed', () => {
    const out = html({ selected: 'SCHOOL_STUDENT' });
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out).toContain('Elegida');
  });

  it('while saving the options wait and it says so', () => {
    const out = html({ selected: 'TEACHER', pending: true });
    expect(out).toContain('Guardando…');
    expect(out.match(/disabled=""/g)!.length).toBe(6);
  });

  it('a failure is an alert that says what to do, and the choice stays marked', () => {
    const out = html({ selected: 'UNIVERSITY_STUDENT', error: 'No se pudo guardar.' });
    expect(out).toContain('role="alert"');
    expect(out).toContain('No se pudo guardar. Toca una opción para intentarlo de nuevo.');
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('has 44 px tall options (min-h-16) and a 44 px skip', () => {
    const out = html();
    expect(out.match(/min-h-16/g)).toHaveLength(5);
    expect(out).toMatch(/min-h-11[^"]*"[^>]*>Omitir por ahora/);
  });
});

describe('step 2: the period', () => {
  const html = (over: Partial<Parameters<typeof PeriodStep>[0]> = {}) =>
    renderToStaticMarkup(
      <PeriodStep primaryUse={null} pending={false} onSubmit={() => {}} {...over} />,
    );

  it('keeps the three fields and the button the rest of the app knows, and no study level yet', () => {
    const out = html();
    for (const label of ['Nombre del periodo', 'Inicio', 'Fin'])
      expect(out).toContain(`>${label}</label>`);
    expect(out).toContain('Continuar');
    expect(out).not.toMatch(/nivel|semestre actual|grado/i);
    expect(out).toMatch(/id="startDate"[^>]*value=""/); // dates are never guessed
    expect(out).toMatch(/id="endDate"[^>]*value=""/);
  });

  it('a personal use is offered its own name; and it never claims the period is optional', () => {
    const out = html({ primaryUse: 'PERSONAL' });
    expect(out).toContain('value="Mi planificación"');
    expect(out).not.toMatch(/no (necesita|hace falta)/i);
    expect(out).toContain('se organizan dentro de un periodo');
  });

  it('shows an error as an alert and a server field error next to its field', () => {
    const out = html({
      error: 'No se pudo guardar.',
      serverFieldErrors: { endDate: ['Fecha inválida.'] },
    });
    expect(out).toContain('role="alert"');
    expect(out).toContain('Fecha inválida.');
  });

  it('while saving the button waits', () => {
    expect(html({ pending: true })).toMatch(/disabled=""[^>]*>Guardando…/);
  });
});

describe('the page, with what the server already knows', () => {
  it('a new account sees the question and nothing about the period', () => {
    const out = page(profile(null, 'NOT_STARTED'), []);
    expect(h1(out)).toBe(QUESTION);
    expect(out).not.toContain('Nombre del periodo');
    expect(out.match(/<h1/g)).toHaveLength(1);
  });

  it('with the answer saved (closed and came back) it continues at the period, with its words', () => {
    const out = page(profile('UNIVERSITY_STUDENT', 'IN_PROGRESS'), []);
    expect(h1(out)).toBe('Tu semestre actual');
    expect(out).toContain('Nombre del periodo');
    expect(out).not.toContain('Omitir por ahora');
  });

  it('skipped, without a period: the period (never the dashboard)', () => {
    const out = page(profile(null, 'SKIPPED'), []);
    expect(h1(out)).toBe('Tu periodo actual');
  });

  it('a period that is not the current one still means the period is missing', () => {
    const out = page(profile('PERSONAL', 'IN_PROGRESS'), [period(false)]);
    expect(h1(out)).toBe('Tu planificación actual');
    expect(out).toContain('Nombre del periodo');
  });

  it('an existing student (period, no answer) can open it and is asked the question, without a period form', () => {
    const out = page(profile(null, 'NOT_STARTED'), [period()]);
    expect(h1(out)).toBe(QUESTION);
    expect(out).not.toContain('Nombre del periodo');
  });

  it('an existing student with everything answered is not shown the onboarding (it leaves for the dashboard)', () => {
    const out = page(profile('UNIVERSITY_STUDENT', 'COMPLETED'), [period()]);
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('Nombre del periodo');
  });

  it('shows the quiet two-step progress, marking the current one in words (aria-current)', () => {
    const one = page(profile(null, 'NOT_STARTED'), []);
    expect(one).toMatch(/<li[^>]*aria-current="step"[^>]*>Perfil<\/li>/);
    const two = page(profile('TEACHER', 'IN_PROGRESS'), []);
    expect(two).toMatch(/<li[^>]*aria-current="step"[^>]*>Periodo<\/li>/);
    expect(one).not.toMatch(/de 7|1 de|paso \d/i); // no promise of steps that do not exist
  });

  it('while loading there is a message, never a blank page', () => {
    const out = page(undefined, undefined);
    expect(out).toContain('Cargando…');
  });
});
