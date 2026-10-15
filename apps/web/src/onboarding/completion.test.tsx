import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AcademicPeriod, Profile, PublicUser, StudyTrack } from '@planner/core';
import {
  currentPeriodsKey,
  currentSubjectsKey,
  homePeriodKey,
  periodsKey,
  subjectsKey,
} from '../academic/useAcademic';
import { ME_KEY } from '../auth/useAuth';
import { OnboardingPage } from '../pages/OnboardingPage';
import { StudiesPage } from '../pages/StudiesPage';
import { PROFILE_KEY } from '../profile/useProfile';
import { studyTracksKey } from '../studyTracks/useStudyTracks';
import { FinalStep } from './FinalStep';
import { LevelStep } from './LevelStep';
import {
  finalStudyName,
  flowFor,
  onboardingStep,
  previousStep,
  progressSteps,
  type OnboardingFacts,
} from './onboardingModel';

const PERIOD_ID = '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70';
const TRACK_ID = '9a8b7c6d-1111-4222-8333-444455556666';
const iso = '2026-10-01T00:00:00.000Z';
const USER: PublicUser = {
  id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  name: 'Ana',
  email: 'ana@example.com',
  timezone: 'America/Bogota',
  createdAt: iso,
};
const profile = (over: Partial<Profile> = {}): Profile => ({
  primaryUse: 'UNIVERSITY_STUDENT',
  programName: null,
  programKey: null,
  onboardingStatus: 'IN_PROGRESS',
  ...over,
});
const period = (over: Partial<AcademicPeriod> = {}): AcademicPeriod => ({
  id: PERIOD_ID,
  name: '2026-2',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: null,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const track = (over: Partial<StudyTrack> = {}): StudyTrack => ({
  id: TRACK_ID,
  name: 'Medicina',
  type: 'UNIVERSITY',
  programKey: 'medicina',
  isPrimary: true,
  status: 'ACTIVE',
  createdAt: iso,
  updatedAt: iso,
  ...over,
});

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('what the last screen says will happen (the same derivation the server uses)', () => {
  const university = (programName: string | null, programKey: string | null = null) =>
    finalStudyName({ primaryUse: 'UNIVERSITY_STUDENT', programName, programKey }, 0);

  it('a university student: the program, or "Universidad" when it was skipped', () => {
    expect(university('Medicina', 'medicina')).toBe('Medicina');
    expect(university('Mi carrera rara')).toBe('Mi carrera rara');
    expect(university(null)).toBe('Universidad');
  });

  it('a school student: "Colegio"; another study: the program or course, or "Otro estudio"', () => {
    expect(
      finalStudyName({ primaryUse: 'SCHOOL_STUDENT', programName: null, programKey: null }, 0),
    ).toBe('Colegio');
    expect(
      finalStudyName(
        { primaryUse: 'OTHER_STUDENT', programName: 'Inglés B2', programKey: null },
        0,
      ),
    ).toBe('Inglés B2');
    expect(
      finalStudyName({ primaryUse: 'OTHER_STUDENT', programName: null, programKey: null }, 0),
    ).toBe('Otro estudio');
  });

  it('promises nothing to a teacher, a personal use or a skipped profile, nor to somebody who already set up a study', () => {
    for (const primaryUse of ['TEACHER', 'PERSONAL', null] as const) {
      expect(
        finalStudyName({ primaryUse, programName: 'Medicina', programKey: 'medicina' }, 0),
      ).toBeNull();
    }
    const uni = {
      primaryUse: 'UNIVERSITY_STUDENT',
      programName: 'Medicina',
      programKey: 'medicina',
    } as const;
    expect(finalStudyName(uni, 1)).toBeNull(); // their own setup in Mis estudios wins
    expect(finalStudyName(uni, undefined)).toBeNull(); // not known yet: nothing is promised
  });

  it('the final screen says it calmly and in the student’s words (no technical words), and says nothing without a study', () => {
    const html = (studyName?: string | null) =>
      renderToStaticMarkup(
        <FinalStep pending={false} studyName={studyName} onImport={() => {}} onHome={() => {}} />,
      );
    const out = html('Medicina');
    expect(out).toContain('Listo. Organizaremos este periodo dentro de');
    expect(out).toContain('Medicina');
    expect(out).not.toMatch(/StudyTrack|migr|adopt|scope|HOME/i);
    expect(out).toContain('Puedes cambiar todo esto después.');
    for (const none of [null, undefined]) expect(html(none)).not.toContain('Organizaremos');
    // both ways out are still there
    expect(out).toContain('Importar mi horario');
    expect(out).toContain('Ir al Inicio');
  });

  it('the page of a student with no study to promise (personal use) reaches the final screen without any promise', () => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    c.setQueryData(ME_KEY, USER);
    c.setQueryData(PROFILE_KEY, profile({ primaryUse: 'PERSONAL' }));
    c.setQueryData(homePeriodKey, period());
    c.setQueryData(studyTracksKey, []);
    const out = renderToStaticMarkup(
      <QueryClientProvider client={c}>
        <StaticRouter location="/onboarding">
          <OnboardingPage />
        </StaticRouter>
      </QueryClientProvider>,
    );
    expect(out).toContain('Listo para empezar');
    expect(out).not.toContain('Organizaremos');
  });
});

describe('both ways out wait for the completion, and a failure keeps the student on the last screen', () => {
  const page = code('../pages/OnboardingPage.tsx');
  const finish = page.slice(page.indexOf('async function finish'), page.indexOf('switch (step)'));

  it('finish() awaits the completion BEFORE it leaves, and both buttons go through it', () => {
    expect(finish.length).toBeGreaterThan(200);
    expect(finish.indexOf('await completeOnboarding.mutateAsync()')).toBeGreaterThan(-1);
    expect(finish.indexOf('await completeOnboarding.mutateAsync()')).toBeLessThan(
      finish.indexOf('setLeavingTo(to)'),
    );
    expect(page).toMatch(/onImport=\{\(\) => void finish\('\/calendar\/import'\)\}/);
    expect(page).toMatch(/onHome=\{\(\) => void finish\('\/dashboard'\)\}/);
  });

  it('a failure stays on the final screen with the error (and a retry), and the draft is kept; success clears it', () => {
    expect(finish).toMatch(
      /catch \(err\) \{\s*setFinishing\(false\);\s*fail\('FINAL'\)\(err as Error\);/,
    );
    expect(finish.indexOf('draft.clear()')).toBeGreaterThan(finish.indexOf('mutateAsync'));
    expect(finish.slice(finish.indexOf('catch'))).not.toMatch(/setLeavingTo|draft\.clear/);
  });

  it('a second tap while it is saving does not call again', () => {
    expect(finish).toMatch(/if \(finishing\) return/);
    expect(page).toMatch(/pending=\{updateProfile\.isPending \|\| finishing\}/);
  });

  it('the page no longer walks the status itself: the server completes it (one call, no PATCH to COMPLETED)', () => {
    expect(page).not.toMatch(/onboardingStatus: 'COMPLETED'/);
    expect(page).not.toMatch(/onboardingStatus: 'IN_PROGRESS' \}\)\s*;\s*\n?\s*await/); // no more IN_PROGRESS -> COMPLETED dance
  });

  it('the completion refreshes everything through the one shared invalidation, after putting the profile in the cache', () => {
    const hook = code('../profile/useProfile.ts');
    const body = hook.slice(hook.indexOf('export function useCompleteOnboarding'));
    expect(body.indexOf('setQueryData(PROFILE_KEY, res.profile)')).toBeGreaterThan(-1);
    expect(body.indexOf('setQueryData(PROFILE_KEY, res.profile)')).toBeLessThan(
      body.indexOf('await invalidateAfterHomeChange(qc)'),
    );
  });

  it('the request is empty (nothing the client could say is sent)', () => {
    const api = code('../api/profile.ts');
    const body = api.slice(api.indexOf('completeOnboardingRequest'));
    expect(body).toMatch(/method: 'POST',\s*body: \{\},/);
  });
});

describe('the steps before the last one are exactly as they were', () => {
  it('the level step of the onboarding keeps "Siguiente" + "Ahora no" (the optional mode is only for adding a study)', () => {
    const html = renderToStaticMarkup(
      <LevelStep
        primaryUse="UNIVERSITY_STUDENT"
        current={{ studyLevel: null, studyLevelNote: null }}
        pending={false}
        onPickNumber={() => {}}
        onSaveNote={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(html).toContain('Siguiente');
    expect(html).toContain('Ahora no');
    const page = src('../pages/OnboardingPage.tsx');
    const usage = page.slice(
      page.indexOf('<LevelStep'),
      page.indexOf('/>', page.indexOf('<LevelStep')),
    );
    expect(usage).not.toMatch(/\boptional\b/);
  });

  it('nothing is created while the student answers: the use, the program, the level and the subjects never call a study', () => {
    const page = code('../pages/OnboardingPage.tsx');
    expect(page).not.toMatch(
      /setupStudy|adoptPeriod|useSetupStudy|useAdoptPeriod|updateStudyTrack|createStudyTrack/,
    );
    // the only call that can create a study is the completion, and it is only made by finish()
    expect(page.match(/completeOnboarding\.mutateAsync\(\)/g)).toHaveLength(1);
  });
});

describe('Mis estudios after completing, and the profile as a proposal only while there is no study', () => {
  const studies = (seed: {
    tracks: StudyTrack[];
    periods: AcademicPeriod[];
    profile?: Profile;
  }) => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    c.setQueryData(studyTracksKey, seed.tracks);
    c.setQueryData(periodsKey, seed.periods);
    c.setQueryData(
      currentPeriodsKey,
      seed.periods
        .filter((p) => p.isCurrent && p.studyTrackId)
        .map((p) => ({
          period: p,
          studyTrack: { id: TRACK_ID, name: 'Medicina', type: 'UNIVERSITY', isPrimary: true },
        })),
    );
    c.setQueryData(currentSubjectsKey, []);
    c.setQueryData(homePeriodKey, seed.periods.find((p) => p.isCurrent) ?? null);
    c.setQueryData(PROFILE_KEY, seed.profile ?? profile({ onboardingStatus: 'COMPLETED' }));
    return renderToStaticMarkup(
      <QueryClientProvider client={c}>
        <StaticRouter location="/settings/studies">
          <StudiesPage />
        </StaticRouter>
      </QueryClientProvider>,
    );
  };

  it('right after completing: the new primary study is there, its period is the SAME one, and there is no "plan to convert"', () => {
    const out = studies({ tracks: [track()], periods: [period({ studyTrackId: TRACK_ID })] });
    expect(out).toContain('Medicina');
    expect(out).toContain('Principal');
    expect(out).toContain(`href="/subjects?period=${PERIOD_ID}"`);
    expect(out).not.toContain('Tu planificación actual');
  });

  it('an older account (finished, no study) still sees its plan and the "Convertir" button, nothing created', () => {
    const out = studies({
      tracks: [],
      periods: [period()],
      profile: profile({ onboardingStatus: 'COMPLETED' }),
    });
    expect(out).toContain('Tu planificación actual');
    expect(out).toContain('Convertir en estudio');
    expect(out).not.toContain('<h3');
  });

  it('the profile proposes the study of the plan ONLY while the account has no study', () => {
    const page = code('../pages/StudiesPage.tsx');
    expect(page).toMatch(/suggestStudy\(allTracks\.length === 0 \? profile\.data : null, legacy\)/);
  });
});

describe('once the account has a study, the program question does not exist (the study is the authority)', () => {
  const facts = (
    over: Partial<OnboardingFacts> & { use?: Profile['primaryUse'] } = {},
  ): OnboardingFacts => ({
    profile: {
      primaryUse: over.use ?? 'UNIVERSITY_STUDENT',
      programName: null,
      onboardingStatus: 'IN_PROGRESS',
    },
    period: over.period === undefined ? { studyLevel: null, studyLevelNote: null } : over.period,
    decided: over.decided ?? new Set<string>(),
    hasStudies: over.hasStudies ?? false,
  });

  it('without a study the program is still asked; with ONE (active or archived) it is settled and the wizard goes on', () => {
    expect(onboardingStep(facts())).toBe('PROGRAM');
    expect(onboardingStep(facts({ hasStudies: true }))).toBe('LEVEL'); // university: the level is next
    expect(onboardingStep(facts({ use: 'OTHER_STUDENT', hasStudies: true }))).toBe('SUBJECTS');
    expect(onboardingStep(facts({ use: 'OTHER_STUDENT' }))).toBe('PROGRAM');
  });

  it('having a study skips ONLY the program: the period, the level and the subjects are still asked when they are missing', () => {
    expect(onboardingStep(facts({ hasStudies: true, period: null }))).toBe('PERIOD');
    expect(onboardingStep(facts({ hasStudies: true }))).toBe('LEVEL');
    expect(
      onboardingStep(facts({ hasStudies: true, period: { studyLevel: 4, studyLevelNote: null } })),
    ).toBe('SUBJECTS');
    expect(
      onboardingStep(
        facts({
          hasStudies: true,
          period: { studyLevel: 4, studyLevelNote: null },
          decided: new Set(['SUBJECTS']),
        }),
      ),
    ).toBe('FINAL');
    // primaryUse stays editable and keeps deciding the rest of the flow
    expect(flowFor('SCHOOL_STUDENT', true)).toEqual(['LEVEL', 'SUBJECTS']);
    expect(flowFor('UNIVERSITY_STUDENT', true)).toEqual(['LEVEL', 'SUBJECTS']);
    expect(flowFor('UNIVERSITY_STUDENT', false)).toEqual(['PROGRAM', 'LEVEL', 'SUBJECTS']);
  });

  it('"Atrás" and the quiet progress marks never lead to the program either', () => {
    expect(previousStep('LEVEL', facts({ hasStudies: true }))).not.toBe('PROGRAM');
    expect(previousStep('LEVEL', facts())).toBe('PROGRAM');
    expect(progressSteps('UNIVERSITY_STUDENT', true)).toEqual([
      'USE',
      'PERIOD',
      'LEVEL',
      'SUBJECTS',
      'FINAL',
    ]);
    expect(progressSteps('UNIVERSITY_STUDENT')).toContain('PROGRAM');
  });

  /** The page with what the server already knows; `studies` undefined = the list has not answered yet. */
  const pageWith = (use: Profile['primaryUse'], studies: StudyTrack[] | undefined) => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    c.setQueryData(ME_KEY, USER);
    c.setQueryData(PROFILE_KEY, profile({ primaryUse: use }));
    c.setQueryData(homePeriodKey, period());
    c.setQueryData(subjectsKey(PERIOD_ID), []);
    if (studies) c.setQueryData(studyTracksKey, studies);
    return renderToStaticMarkup(
      <QueryClientProvider client={c}>
        <StaticRouter location="/onboarding">
          <OnboardingPage />
        </StaticRouter>
      </QueryClientProvider>,
    );
  };

  it('the page: university with no study asks the program (as always); with a study it never renders it', () => {
    expect(pageWith('UNIVERSITY_STUDENT', [])).toContain('Carrera o programa');
    for (const studies of [[track()], [track({ status: 'ARCHIVED', isPrimary: false })]]) {
      const out = pageWith('UNIVERSITY_STUDENT', studies);
      expect(out).not.toContain('Carrera o programa');
      expect(out).not.toContain('Mi carrera no aparece');
      expect(out).toContain('¿En qué semestre estás?'); // straight to what is still pending
      expect(out).not.toContain('se administra desde Mis estudios');
    }
  });

  it('the page: another study with a study goes to its subjects; without one it asks the program', () => {
    expect(pageWith('OTHER_STUDENT', [])).toContain('Curso o programa');
    const out = pageWith('OTHER_STUDENT', [track({ type: 'OTHER_ACADEMIC' })]);
    expect(out).not.toContain('Curso o programa');
    expect(out).toContain('¿Qué materias o módulos tienes?');
  });

  it('while the list of studies has not answered nothing is decided (no step is assumed "with no studies")', () => {
    const out = pageWith('UNIVERSITY_STUDENT', undefined);
    expect(out).toContain('Cargando…');
    expect(out).not.toContain('Carrera o programa');
    expect(out).not.toContain('¿En qué semestre estás?');
  });

  it('the page never writes the program on its own: the only writes of it are two handlers of the program step', () => {
    const page = code('../pages/OnboardingPage.tsx');
    // no effect touches the program or decides a step from render
    for (const effect of page.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\)/g) ?? []) {
      expect(effect).not.toMatch(/programKey|programName|decide\(|updateProfile/);
    }
    expect(page.match(/updateProfile\.mutate\(\{ program(Key|Name)/g)).toHaveLength(2);
    // and both handlers are only wired to the PROGRAM case, which the derived step never reaches with a study
    const programCase = page.slice(page.indexOf("case 'PROGRAM'"), page.indexOf("case 'LEVEL'"));
    expect(programCase).toMatch(/onPickCatalog=\{pickProgram\}/);
    expect(programCase).toMatch(/onSaveCustom=\{saveProgram\}/);
    expect(page.indexOf('pickProgram', page.indexOf("case 'LEVEL'"))).toBe(-1);
    expect(page).toMatch(/view === 'PROGRAM' && hasStudies \? derived/);
  });
});
