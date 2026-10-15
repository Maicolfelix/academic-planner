import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type {
  AcademicPeriod,
  CurrentPeriodContext,
  Profile,
  StudyTrack,
  Subject,
} from '@planner/core';
import {
  currentPeriodsKey,
  currentSubjectsKey,
  homePeriodKey,
  invalidateAfterHomeChange,
  periodsKey,
  subjectsKey,
} from '../academic/useAcademic';
import { ME_KEY } from '../auth/useAuth';
import { ApiRequestError } from '../api/client';
import { LevelStep } from '../onboarding/LevelStep';
import { exclusiveLevelInput, levelCopy, levelNext } from '../onboarding/onboardingModel';
import { AdoptDialog } from '../pages/studies/AdoptDialog';
import { AddStudyDialog } from '../pages/studies/AddStudyDialog';
import { StudiesPage } from '../pages/StudiesPage';
import { SubjectsPage } from '../pages/SubjectsPage';
import { PROFILE_KEY } from '../profile/useProfile';
import { studyTracksKey } from '../studyTracks/useStudyTracks';
import {
  activeCards,
  archivedTracks,
  legacyPlan,
  levelLabel,
  periodsOf,
  studyErrorText,
  subjectsCountLabel,
  suggestStudy,
  typeLabel,
} from './studyModel';
import {
  defaultStudyName,
  emptyWizard,
  primaryUseOf,
  stepAfter,
  stepBefore,
  toSetupRequest,
  wizardSteps,
} from './studyWizardModel';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = '2026-10-01T00:00:00.000Z';

const period = (
  n: number,
  name: string,
  studyTrackId: string | null,
  over: Partial<AcademicPeriod> = {},
): AcademicPeriod => ({
  id: U(100 + n),
  name,
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const track = (n: number, name: string, over: Partial<StudyTrack> = {}): StudyTrack => ({
  id: U(n),
  name,
  type: 'UNIVERSITY',
  programKey: null,
  isPrimary: false,
  status: 'ACTIVE',
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const current = (p: AcademicPeriod, t: StudyTrack | null): CurrentPeriodContext => ({
  period: p,
  studyTrack: t && { id: t.id, name: t.name, type: t.type, isPrimary: t.isPrimary },
});
const subject = (n: number, name: string, periodId: string): Subject =>
  ({ id: U(300 + n), periodId, name, color: '#3B82F6' }) as Subject;

const MED = track(10, 'Medicina', { isPrimary: true });
const DIP = track(11, 'Diplomado en Ciberseguridad', { type: 'OTHER_ACADEMIC' });
const MED_P = period(2, '2026-2', MED.id, { studyLevel: 4 });
const DIP_P = period(3, 'Cohorte', DIP.id);
const GENERAL_P = period(1, 'Mi planificación', null);

interface Seed {
  tracks?: StudyTrack[];
  periods?: AcademicPeriod[];
  currents?: CurrentPeriodContext[];
  subjects?: Subject[];
  home?: AcademicPeriod | null;
  profile?: Partial<Profile>;
}
const PROFILE: Profile = {
  primaryUse: 'UNIVERSITY_STUDENT',
  programName: 'Medicina',
  programKey: 'medicina',
  onboardingStatus: 'COMPLETED',
};

function client(seed: Seed) {
  const c = new QueryClient();
  c.setQueryData(studyTracksKey, seed.tracks ?? []);
  c.setQueryData(periodsKey, seed.periods ?? []);
  c.setQueryData(currentPeriodsKey, seed.currents ?? []);
  c.setQueryData(currentSubjectsKey, seed.subjects ?? []);
  c.setQueryData(homePeriodKey, seed.home === undefined ? null : seed.home);
  c.setQueryData(PROFILE_KEY, { ...PROFILE, ...seed.profile });
  return c;
}
const wrap = (node: React.ReactNode, c: QueryClient, location = '/settings/studies') =>
  renderToStaticMarkup(
    <QueryClientProvider client={c}>
      <StaticRouter location={location}>{node}</StaticRouter>
    </QueryClientProvider>,
  );
const page = (seed: Seed) => wrap(<StudiesPage />, client(seed));

describe('the pure model of "Mis estudios"', () => {
  it('says the level in the words of the kind of study, or the note the student wrote', () => {
    const none = { studyLevel: null, studyLevelNote: null };
    expect(levelLabel('UNIVERSITY', { ...none, studyLevel: 4 })).toBe('4.º semestre');
    expect(levelLabel('SCHOOL', { ...none, studyLevel: 9 })).toBe('Grado 9');
    expect(levelLabel('OTHER_ACADEMIC', { ...none, studyLevel: 3 })).toBe('Nivel 3');
    expect(levelLabel('UNIVERSITY', { ...none, studyLevelNote: 'Internado' })).toBe('Internado');
    expect(levelLabel('UNIVERSITY', none)).toBeNull();
    expect(subjectsCountLabel(0)).toBe('Sin materias');
    expect(subjectsCountLabel(1)).toBe('1 materia');
    expect(subjectsCountLabel(6)).toBe('6 materias');
    expect(typeLabel('OTHER_ACADEMIC')).toBe('Otro estudio');
  });

  it('builds a card per ACTIVE study with its current period and the subjects of THAT period only', () => {
    const cards = activeCards(
      [MED, DIP, track(12, 'Viejo', { status: 'ARCHIVED' })],
      [current(MED_P, MED)],
      [subject(1, 'A', MED_P.id), subject(2, 'B', MED_P.id), subject(3, 'C', DIP_P.id)],
    );
    expect(cards.map((c) => c.track.name)).toEqual(['Medicina', 'Diplomado en Ciberseguridad']);
    expect(cards[0]).toMatchObject({ subjectCount: 2, current: { id: MED_P.id } });
    expect(cards[1]).toMatchObject({ subjectCount: 0, current: null }); // "Sin periodo actual"
    expect(archivedTracks([MED, track(12, 'Viejo', { status: 'ARCHIVED' })])).toHaveLength(1);
    expect(periodsOf([MED_P, DIP_P, GENERAL_P], MED.id)).toEqual([MED_P]);
  });

  it('the legacy plan is the CURRENT period without a study, nothing else', () => {
    expect(legacyPlan([MED_P, GENERAL_P])).toBe(GENERAL_P);
    expect(legacyPlan([MED_P])).toBeNull();
    expect(legacyPlan([period(5, 'Vieja', null, { isCurrent: false })])).toBeNull();
  });

  it('proposes a study from the profile and the period, and never invents what nothing says', () => {
    expect(suggestStudy(PROFILE, GENERAL_P)).toEqual({
      name: 'Medicina',
      programKey: 'medicina',
      type: 'UNIVERSITY',
    });
    // a program of their own: the name, no key
    expect(
      suggestStudy({ ...PROFILE, programName: 'Mi carrera', programKey: null }, GENERAL_P),
    ).toEqual({
      name: 'Mi carrera',
      programKey: null,
      type: 'UNIVERSITY',
    });
    // a key that does not match the name is not trusted
    expect(
      suggestStudy({ ...PROFILE, programName: 'Derecho', programKey: 'medicina' }, GENERAL_P),
    ).toMatchObject({
      name: 'Derecho',
      programKey: null,
    });
    // no program: the period's own name, editable
    expect(suggestStudy({ ...PROFILE, programName: null, programKey: null }, GENERAL_P).name).toBe(
      'Mi planificación',
    );
    // a teacher / personal use / no profile: no type is guessed
    expect(suggestStudy({ ...PROFILE, primaryUse: 'TEACHER' }, GENERAL_P).type).toBeNull();
    expect(suggestStudy({ ...PROFILE, primaryUse: 'PERSONAL' }, GENERAL_P).type).toBeNull();
    expect(suggestStudy(undefined, GENERAL_P)).toEqual({
      name: 'Mi planificación',
      programKey: null,
      type: null,
    });
    expect(suggestStudy({ ...PROFILE, primaryUse: 'SCHOOL_STUDENT' }, GENERAL_P).type).toBe(
      'SCHOOL',
    );
    expect(suggestStudy({ ...PROFILE, primaryUse: 'OTHER_STUDENT' }, GENERAL_P).type).toBe(
      'OTHER_ACADEMIC',
    );
  });

  it('says a refused action in plain words, never as a code', () => {
    const err = (code: string, message = 'texto del servidor') =>
      new ApiRequestError(409, code, message);
    expect(studyErrorText(err('PRIMARY_TRACK_REQUIRES_REPLACEMENT'))).toBe(
      'Elige primero otro estudio como principal.',
    );
    expect(studyErrorText(err('STUDY_TRACK_ARCHIVED'))).toContain('Restáuralo');
    expect(studyErrorText(err('PERIOD_ALREADY_IN_STUDY'))).toBe(
      'Ese periodo ya pertenece a un estudio.',
    );
    expect(studyErrorText(err('OTRO', 'Mensaje humano.'))).toBe('Mensaje humano.');
    expect(studyErrorText(new Error('sin red'))).toBe('sin red');
  });
});

describe('the "Agregar estudio" flow as data', () => {
  it('has the same six steps for every kind of study: the level is asked (optionally) for "otro estudio" too', () => {
    const six = ['TYPE', 'NAME', 'PERIOD', 'LEVEL', 'SUBJECTS', 'CONFIRM'];
    for (const type of ['UNIVERSITY', 'SCHOOL', 'OTHER_ACADEMIC'] as const) {
      expect(wizardSteps(type), type).toEqual(six);
    }
    expect(stepAfter('PERIOD', 'OTHER_ACADEMIC')).toBe('LEVEL');
    expect(stepAfter('LEVEL', 'OTHER_ACADEMIC')).toBe('SUBJECTS');
    expect(stepBefore('SUBJECTS', 'OTHER_ACADEMIC')).toBe('LEVEL');
    expect(stepBefore('TYPE', null)).toBeNull();
    expect(stepAfter('CONFIRM', 'SCHOOL')).toBeNull();
  });

  it('offers "Colegio" for a school and nothing for the others; dates and names are never guessed', () => {
    expect(defaultStudyName('SCHOOL')).toBe('Colegio');
    expect(defaultStudyName('UNIVERSITY')).toBe('');
    expect(defaultStudyName('OTHER_ACADEMIC')).toBe('');
    expect(emptyWizard.period).toBeNull();
    expect(primaryUseOf('UNIVERSITY')).toBe('UNIVERSITY_STUDENT');
    expect(primaryUseOf('SCHOOL')).toBe('SCHOOL_STUDENT');
    expect(primaryUseOf('OTHER_ACADEMIC')).toBe('OTHER_STUDENT');
  });

  it('builds ONE request with only what the student said: no owner, flag, id, context or color', () => {
    const base = {
      ...emptyWizard,
      type: 'UNIVERSITY' as const,
      period: { name: '2026-2', startDate: '2026-08-03', endDate: '2026-11-28' },
    };
    const catalog = toSetupRequest({ ...base, name: 'Medicina', programKey: 'medicina' });
    expect(catalog.track).toEqual({ type: 'UNIVERSITY', programKey: 'medicina' }); // the key brings the name
    const custom = toSetupRequest({
      ...base,
      type: 'OTHER_ACADEMIC',
      name: 'Inglés B2',
      level: { studyLevel: null, studyLevelNote: null },
      subjects: ['Speaking', 'Writing'],
    });
    expect(custom).toEqual({
      track: { type: 'OTHER_ACADEMIC', name: 'Inglés B2' },
      period: base.period,
      subjects: ['Speaking', 'Writing'],
    });
    const withLevel = toSetupRequest({
      ...base,
      name: 'X',
      level: { studyLevel: 4, studyLevelNote: null },
    });
    expect(withLevel.period).toMatchObject({ studyLevel: 4 });
    expect(withLevel.period).not.toHaveProperty('studyLevelNote');
    const withNote = toSetupRequest({
      ...base,
      name: 'X',
      level: { studyLevel: null, studyLevelNote: 'Internado' },
    });
    expect(withNote.period).toMatchObject({ studyLevelNote: 'Internado' });
    expect(withNote).not.toHaveProperty('subjects'); // optional: omitted when empty
    expect(JSON.stringify([catalog, custom, withLevel, withNote])).not.toMatch(
      /userId|isPrimary|status|periodId|studyTrackId|educationContext|color/,
    );
    expect(() => toSetupRequest({ ...emptyWizard, name: 'X' })).toThrow();
  });
});

describe('the screen: it only READS what it opens, and each state says what it is', () => {
  it('an OLDER account (a profile, a plan, no study): the plan is offered with its subjects, and no study is drawn', () => {
    const out = page({
      periods: [GENERAL_P],
      currents: [current(GENERAL_P, null)],
      subjects: [subject(1, 'Farmacología', GENERAL_P.id), subject(2, 'Anatomía', GENERAL_P.id)],
      home: GENERAL_P,
    });
    expect(out).toContain('Tu planificación actual');
    expect(out).toContain('Mi planificación');
    expect(out).toContain('2 materias');
    expect(out).toContain('Convertir en estudio');
    expect(out).not.toContain('Estudios activos');
    expect(out).not.toContain('Aún no tienes estudios'); // the plan is something to show, not an empty state
    expect(out).not.toContain('<h3');
  });

  it('no studies and no plan: one clear way forward', () => {
    const out = page({});
    expect(out).toContain('Aún no tienes estudios.');
    expect(out.match(/Agregar estudio/g)?.length).toBeGreaterThanOrEqual(2); // the header and the empty state
    expect(out).not.toContain('Tu planificación actual');
  });

  it('one study: simple. Three: a card each, the main one marked with a WORD, and a link to its OWN period', () => {
    const one = page({
      tracks: [MED],
      periods: [MED_P],
      currents: [current(MED_P, MED)],
      subjects: [subject(1, 'Farmacología', MED_P.id)],
      home: MED_P,
    });
    expect(one).toContain('Estudios activos');
    expect(one).toContain('Principal');
    expect(one).toContain('Universidad');
    expect(one).toContain('4.º semestre');
    expect(one).toContain('1 materia');
    expect(one).not.toContain('Tu planificación actual');
    expect(one).not.toContain('Archivados');
    expect(one).toContain(`href="/subjects?period=${MED_P.id}"`);

    const colegio = track(12, 'Colegio San José', { type: 'SCHOOL' });
    const colegioP = period(4, 'Año 2026', colegio.id, { studyLevel: 9 });
    const three = page({
      tracks: [MED, DIP, colegio],
      periods: [MED_P, DIP_P, colegioP],
      currents: [current(MED_P, MED), current(DIP_P, DIP), current(colegioP, colegio)],
      subjects: [subject(1, 'Redes', DIP_P.id)],
      home: MED_P,
    });
    expect((three.match(/<h3/g) ?? []).length).toBe(3);
    expect((three.match(/>Principal</g) ?? []).length).toBe(1);
    expect(three).toContain('Otro estudio');
    expect(three).toContain('Colegio');
    expect(three).toContain('Grado 9');
    expect(three).toContain(`href="/subjects?period=${DIP_P.id}"`);
    expect(three).toContain(`href="/subjects?period=${colegioP.id}"`);
    // the secondary actions sit behind ONE button per card, named after the study
    expect(three).toContain('aria-label="Más acciones: Diplomado en Ciberseguridad"');
  });

  it('long names wrap instead of overflowing', () => {
    const long = track(
      10,
      'Diplomado de especialización en seguridad informática y redes de computadores',
      {
        isPrimary: true,
      },
    );
    const out = page({
      tracks: [long],
      periods: [MED_P],
      currents: [current(MED_P, long)],
      home: MED_P,
    });
    expect(out).toMatch(/<h3 class="[^"]*break-words[^"]*">Diplomado de especialización/);
  });

  it('a study whose period is current keeps its "Ver materias" link even when there is NO HOME', () => {
    // the main study has no current period and a secondary one does: HOME is null, and the explicit link must still be there
    const out = page({
      tracks: [MED, DIP],
      periods: [MED_P, DIP_P],
      currents: [current(DIP_P, DIP)],
      home: null,
    });
    expect(out).toContain(`href="/subjects?period=${DIP_P.id}"`);
    expect(out).toContain('aria-label="Ver materias de Diplomado en Ciberseguridad"');
    expect(out).not.toContain(`href="/subjects?period=${MED_P.id}"`); // Medicina has none current: nothing to open
  });

  it('a study without a current period says so and offers to choose or create one (no link to subjects)', () => {
    const out = page({ tracks: [DIP, MED], periods: [DIP_P], currents: [], home: null });
    expect(out).toContain('Sin periodo actual.');
    expect(out).toContain('Elegir o crear periodo');
    expect(out).not.toContain('/subjects?period=');
    // and when the app has no HOME at all, the screen says it in calm words
    expect(out).toContain('todavía no tiene un periodo actual');
  });

  it('archived only: no active studies, an Archivados section with Restaurar (named after the study)', () => {
    const old = track(12, 'Inglés B2', { status: 'ARCHIVED', type: 'OTHER_ACADEMIC' });
    const out = page({ tracks: [old] });
    expect(out).toContain('No tienes estudios activos.');
    expect(out).toContain('Archivados');
    expect(out).toContain('Archivado');
    expect(out).toContain('aria-label="Restaurar Inglés B2"');
    expect(out).not.toContain('Estudios activos');
  });

  it('has one h1 and a labelled section for every group', () => {
    const out = page({
      tracks: [MED, track(12, 'Viejo', { status: 'ARCHIVED' })],
      periods: [MED_P, GENERAL_P],
      currents: [current(MED_P, MED)],
      home: MED_P,
    });
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
    for (const id of ['legacy-plan-title', 'active-studies-title', 'archived-studies-title']) {
      expect(out).toContain(`aria-labelledby="${id}"`);
      expect(out).toContain(`id="${id}"`);
    }
  });
});

describe('opening the screen never writes', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const code = (p: string) =>
    src(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');

  it('the page and the components it shows hold no effect that mutates, and every write sits behind a handler', () => {
    for (const file of [
      '../pages/StudiesPage.tsx',
      '../pages/studies/StudyCard.tsx',
      '../pages/studies/LegacyPlanCard.tsx',
    ]) {
      expect(code(file), file).not.toMatch(/useEffect|\.mutate\(|\.mutateAsync\(/);
    }
    // the page itself uses no mutation hook at all: only its dialogs do, and only on a click or a submit
    expect(code('../pages/StudiesPage.tsx')).not.toMatch(
      /useAdoptPeriod|useSetupStudy|useUpdate|useMake|useArchive|useRestore/,
    );
    for (const file of [
      '../pages/studies/AdoptDialog.tsx',
      '../pages/studies/AddStudyDialog.tsx',
      '../pages/studies/EditStudyDialog.tsx',
      '../pages/studies/StudyActionDialog.tsx',
      '../pages/studies/PeriodsDialog.tsx',
    ]) {
      const c = code(file);
      // a mutate() call never lives inside an effect
      expect(c.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\)/g)?.join('\n') ?? '', file).not.toMatch(
        /\.mutate\(/,
      );
    }
  });

  it('the profile is read to PROPOSE only: nothing on the screen writes it', () => {
    for (const file of ['../pages/StudiesPage.tsx', '../pages/studies/AdoptDialog.tsx']) {
      expect(code(file), file).not.toMatch(/useUpdateProfile|updateProfileRequest|PATCH/);
    }
    expect(code('../studyTracks/useStudyTracks.ts')).not.toMatch(/profile/i);
  });

  it('the opening of the dialogs renders their first step without calling anything', () => {
    const c = client({ periods: [GENERAL_P] });
    const adopt = wrap(
      <AdoptDialog
        period={GENERAL_P}
        suggestion={suggestStudy(PROFILE, GENERAL_P)}
        onClose={() => {}}
        onDone={() => {}}
      />,
      c,
    );
    expect(adopt).toContain('value="Medicina"'); // the proposal, prefilled
    expect(adopt).toContain('Es una propuesta');
    expect(adopt).toContain('no se copia ni se borra nada');
    const add = wrap(<AddStudyDialog onClose={() => {}} onDone={() => {}} />, c);
    expect(add).toContain('Paso 1 de 6');
    expect(add).toContain('¿Qué tipo de estudio es?');
    for (const t of ['Universidad', 'Colegio', 'Otro estudio']) expect(add).toContain(t);
    expect(add).not.toContain('Docente'); // no personal or teacher kind of study
    expect(add).not.toContain('Personal');
  });

  it('the adopt dialog does not depend on the plan staying "without a study": it must outlive the change it causes to report success', () => {
    // a mutation callback never runs once its component unmounted, and the plan stops being legacy the moment it is adopted
    const text = code('../pages/StudiesPage.tsx');
    expect(text).toMatch(/kind: 'adopt'; period: AcademicPeriod; suggestion: Suggestion/);
    expect(text).not.toMatch(/dialog\?\.kind === 'adopt' && legacy/);
  });

  it('an unknown kind of study is NOT guessed: the adopt form starts with the type unchosen', () => {
    const none = suggestStudy({ ...PROFILE, primaryUse: 'TEACHER' }, GENERAL_P);
    const out = wrap(
      <AdoptDialog period={GENERAL_P} suggestion={none} onClose={() => {}} onDone={() => {}} />,
      client({}),
    );
    expect(out).toContain('Elige el tipo…');
    expect(out).not.toMatch(/<option value="UNIVERSITY" selected/);
  });
});

describe('the subjects screen works for an explicit period, and says which study it is', () => {
  const seed: Seed = {
    tracks: [MED, DIP],
    periods: [MED_P, DIP_P],
    home: MED_P,
    currents: [current(MED_P, MED), current(DIP_P, DIP)],
  };
  const at = (location: string, c = client(seed)) => {
    c.setQueryData(subjectsKey(MED_P.id), [subject(1, 'Farmacología', MED_P.id)]);
    c.setQueryData(subjectsKey(DIP_P.id), [subject(2, 'Seguridad de Redes', DIP_P.id)]);
    return wrap(<SubjectsPage />, c, location);
  };

  it('without ?period it is HOME, as always', () => {
    const out = at('/subjects');
    expect(out).toContain('Farmacología');
    expect(out).not.toContain('Seguridad de Redes');
    expect(out).toContain('Medicina · 2026-2'); // with several studies the title says which one
  });

  it('with ?period it is THAT period, with the study in the title and a way back', () => {
    const out = at(`/subjects?period=${DIP_P.id}`);
    expect(out).toContain('Seguridad de Redes');
    expect(out).not.toContain('Farmacología');
    expect(out).toContain('Diplomado en Ciberseguridad · Cohorte');
    expect(out).toContain('Volver a Mis estudios');
    expect(out).toContain('href="/settings/studies"');
  });

  it('a plan without a study keeps just the period name; one study does not repeat itself', () => {
    const c = client({ periods: [GENERAL_P], home: GENERAL_P });
    c.setQueryData(subjectsKey(GENERAL_P.id), []);
    expect(wrap(<SubjectsPage />, c, '/subjects')).toContain('Mi planificación · ');
    expect(wrap(<SubjectsPage />, c, '/subjects')).not.toContain(' · Mi planificación');
    const one = client({ tracks: [MED], periods: [MED_P], home: MED_P });
    one.setQueryData(subjectsKey(MED_P.id), []);
    expect(wrap(<SubjectsPage />, one, '/subjects')).not.toContain('Medicina · 2026-2');
  });

  it('a period that is not the user’s (or does not exist) is the same message, whatever its id', () => {
    const a = at(`/subjects?period=${U(999)}`);
    expect(a).toContain('No encontramos ese periodo.');
    expect(a).toContain('Ir a Mis estudios');
    expect(a).not.toContain('Farmacología');
    expect(a).not.toContain('Agregar asignatura');
  });

  it('a new subject goes to the period shown (an explicit destination), and the period comes from the list the server gave', () => {
    const src = readFileSync(new URL('../pages/SubjectsPage.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/periods\.data\?\.find\(\(p\) => p\.id === id\)/); // owned periods only
    expect(src).toMatch(/useSubjects\(period\.id\)/);
    expect(src).toMatch(/periodId=\{period\.id\}/);
    expect(src).not.toMatch(/studyTrackId\s*:|periodIds/); // the study is only READ from the period, never sent
  });
});

describe('every study mutation refreshes everything that depends on it, and nothing it does not touch', () => {
  it('invalidateAfterHomeChange marks the studies, the lists and the summaries stale, never who the user is nor the profile', async () => {
    const c = client({ tracks: [MED], periods: [MED_P], home: MED_P });
    c.setQueryData(ME_KEY, { id: 'x' });
    c.setQueryData(['activities', {}], []);
    c.setQueryData(['dashboard'], {});
    c.setQueryData(['radar'], {});
    c.setQueryData(['progress'], {});
    await invalidateAfterHomeChange(c);
    const stale = (key: readonly unknown[]) => c.getQueryState(key)?.isInvalidated;
    for (const key of [
      studyTracksKey,
      periodsKey,
      currentPeriodsKey,
      homePeriodKey,
      currentSubjectsKey,
      ['activities', {}],
      ['dashboard'],
      ['radar'],
      ['progress'],
    ]) {
      expect(stale(key), JSON.stringify(key)).toBe(true);
    }
    expect(stale(ME_KEY)).toBe(false);
    expect(stale(PROFILE_KEY)).toBe(false);
  });

  it('all the study hooks (and the study-period ones) go through that one refresh', () => {
    const src = readFileSync(new URL('../studyTracks/useStudyTracks.ts', import.meta.url), 'utf8');
    expect(src.match(/invalidateAfterHomeChange\(qc\)/g)).toHaveLength(1); // in the ONE shared hook
    for (const hook of [
      'useMakeStudyTrackPrimary',
      'useArchiveStudyTrack',
      'useRestoreStudyTrack',
      'useUpdateStudyTrack',
      'useSetupStudy',
      'useAdoptPeriod',
      'useCreateStudyPeriod',
      'useUpdateStudyPeriod',
    ]) {
      expect(src, hook).toMatch(new RegExp(`${hook} = \\(\\) =>\\s*useStudyMutation`));
    }
  });
});

describe('the study screens keep the rules of the product', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const files = [
    '../pages/StudiesPage.tsx',
    '../pages/studies/StudyCard.tsx',
    '../pages/studies/AddStudyDialog.tsx',
    '../pages/studies/AdoptDialog.tsx',
    '../pages/studies/EditStudyDialog.tsx',
    '../pages/studies/PeriodsDialog.tsx',
    '../pages/studies/StudyActionDialog.tsx',
    './studyModel.ts',
    './studyWizardModel.ts',
  ];
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

  it('no technical word reaches the student, and no behaviour depends on a program or a type', () => {
    const text = (html: string) => html.replace(/<[^>]*>/g, ' ');
    const rendered = [
      page({
        tracks: [MED, DIP, track(12, 'Viejo', { status: 'ARCHIVED' })],
        periods: [MED_P, DIP_P, GENERAL_P],
        currents: [current(MED_P, MED)],
        home: MED_P,
      }),
      wrap(<AddStudyDialog onClose={() => {}} onDone={() => {}} />, client({})),
      wrap(
        <AdoptDialog
          period={GENERAL_P}
          suggestion={suggestStudy(PROFILE, GENERAL_P)}
          onClose={() => {}}
          onDone={() => {}}
        />,
        client({}),
      ),
    ].map(text);
    for (const t of rendered) {
      expect(t).not.toMatch(
        /StudyTrack|EducationContext|programKey|\bscope\b|\bHOME\b|UNIVERSITY|OTHER_ACADEMIC/,
      );
    }
    for (const f of files) {
      expect(code(read(f)), f).not.toMatch(/=== ?'Medicina'|\.name === '/);
    }
  });

  it('nothing here sends an owner, a primary flag, a status or a period list; no workspace selector exists', () => {
    for (const f of files) {
      const text = code(read(f));
      expect(text, f).not.toMatch(/userId|periodIds/);
      expect(text, f).not.toMatch(/<select|StudySwitcher|selectedStudy|currentStudy/);
    }
  });

  it('the app gives Mis estudios its own route outside the HOME gate, and the way in is in the top bar', () => {
    const app = read('../App.tsx');
    const route = app.indexOf('path="/settings/studies"');
    const gate = app.indexOf('<RequirePeriod />');
    expect(route).toBeGreaterThan(-1);
    expect(route).toBeLessThan(gate); // it does not wait for a HOME period: it is where one gets fixed
    // /subjects is outside that gate too: the page asks for HOME itself, and only when no explicit period is named
    const subjects = app.indexOf('path="/subjects"');
    expect(subjects).toBeGreaterThan(-1);
    expect(subjects).toBeLessThan(gate);
    expect(app.slice(gate)).not.toContain('path="/subjects"');
    const page = read('../pages/SubjectsPage.tsx');
    expect(page).toMatch(/case 'ONBOARD':\s*return <Navigate to="\/onboarding" replace \/>/);
    expect(read('../components/AppShell.tsx')).toMatch(/to="\/settings\/studies"/);
  });
});

describe('an explicit period needs no HOME; the plain subjects page still does', () => {
  const NO_HOME: Seed = {
    tracks: [MED, DIP],
    periods: [MED_P, DIP_P],
    home: null,
    currents: [current(DIP_P, DIP)],
  };
  const subjectsAt = (location: string, seed: Seed) => {
    const c = client(seed);
    c.setQueryData(subjectsKey(MED_P.id), [subject(1, 'Farmacología', MED_P.id)]);
    c.setQueryData(subjectsKey(DIP_P.id), [subject(2, 'Seguridad de Redes', DIP_P.id)]);
    return wrap(<SubjectsPage />, c, location);
  };

  it('with a HOME period, an explicit period opens THAT one (not HOME)', () => {
    const out = subjectsAt(`/subjects?period=${DIP_P.id}`, { ...NO_HOME, home: MED_P });
    expect(out).toContain('Seguridad de Redes');
    expect(out).not.toContain('Farmacología');
  });

  it('with NO HOME, a secondary study’s current period opens its subjects (HOME is not consulted)', () => {
    const out = subjectsAt(`/subjects?period=${DIP_P.id}`, NO_HOME);
    expect(out).toContain('Mis asignaturas');
    expect(out).toContain('Seguridad de Redes');
    expect(out).toContain('Diplomado en Ciberseguridad · Cohorte');
    expect(out).toContain('Agregar asignatura'); // and a new subject there goes to THAT period (periodId={period.id})
  });

  it('with NO HOME, the plain /subjects does not render the page: it sends the user to the onboarding, as before', () => {
    const out = subjectsAt('/subjects', NO_HOME);
    expect(out).toBe(''); // <Navigate to="/onboarding" replace />: nothing of the page is drawn
    // and with a HOME it is the page, as always
    expect(subjectsAt('/subjects', { ...NO_HOME, home: MED_P })).toContain('Farmacología');
  });

  it('a foreign or unknown period is the same message with or without a HOME, and never the onboarding', () => {
    const ghost = `/subjects?period=${U(999)}`;
    for (const seed of [NO_HOME, { ...NO_HOME, home: MED_P }]) {
      const out = subjectsAt(ghost, seed);
      expect(out).toContain('No encontramos ese periodo.');
      expect(out).toContain('Ir a Mis estudios');
    }
  });

  it('the explicit branch never consults HOME: it is a guard on the source, not only on a render', () => {
    const src = readFileSync(new URL('../pages/SubjectsPage.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');
    const explicit = src.slice(
      src.indexOf('function ExplicitPeriodSubjects'),
      src.indexOf('function SubjectsView'),
    );
    expect(explicit.length).toBeGreaterThan(200);
    expect(explicit).not.toMatch(
      /useHomePeriod|useCurrentPeriod|homeGate|RequirePeriod|onboarding/,
    );
    const home = src.slice(
      src.indexOf('function HomePeriodSubjects'),
      src.indexOf('function ExplicitPeriodSubjects'),
    );
    expect(home).toMatch(/useHomePeriod\(\)/);
    expect(home).toMatch(/homeGate\(home\)/);
  });
});

describe('the level of a study, for every kind: a number OR a few words, always optional', () => {
  const none = { studyLevel: null, studyLevelNote: null };
  const step = (primaryUse: 'UNIVERSITY_STUDENT' | 'SCHOOL_STUDENT' | 'OTHER_STUDENT') =>
    wrap(
      <LevelStep
        primaryUse={primaryUse}
        current={none}
        pending={false}
        onPickNumber={() => {}}
        onSaveNote={() => {}}
        onSkip={() => {}}
        optional
      />,
      client({}),
    );

  it('"otro estudio" says "nivel" (never "semestre"), offers a number or words and no quick numbers', () => {
    const copy = levelCopy('OTHER_STUDENT');
    expect(copy).toMatchObject({ title: '¿En qué nivel estás?', noun: 'Nivel', options: 0 });
    expect(copy.placeholder).toContain('Módulo 3');
    const out = step('OTHER_STUDENT');
    expect(out).toContain('Número (hasta 99)');
    expect(out).toContain('O descríbelo');
    expect(out).toContain('Módulo 3, Nivel B2, Etapa final');
    expect(out).not.toMatch(/Semestre|aria-label="Nivel \d/);
    expect(out).not.toContain('>Otro<'); // there is nothing to expand: the two fields are the answer
    expect(out).toContain('Ahora no'); // and it can still be skipped
  });

  it('a university and a school keep their words and their quick numbers', () => {
    expect(levelCopy('UNIVERSITY_STUDENT')).toMatchObject({ noun: 'Semestre', options: 10 });
    expect(levelCopy('SCHOOL_STUDENT')).toMatchObject({ noun: 'Grado', options: 11 });
    expect(step('UNIVERSITY_STUDENT')).toContain('aria-label="Semestre 4"');
    expect(step('SCHOOL_STUDENT')).toContain('aria-label="Grado 9"');
  });

  it('Siguiente with nothing is "no level" when adding a study (and still an error in the onboarding)', () => {
    const base = { picked: null, number: '', note: '', currentLevel: null, noun: 'Nivel' };
    expect(levelNext({ ...base, other: true, emptyMeansSkip: true })).toEqual({ kind: 'skip' });
    expect(levelNext({ ...base, other: false, emptyMeansSkip: true })).toEqual({ kind: 'skip' });
    expect(levelNext({ ...base, other: true }).kind).toBe('error');
    expect(levelNext({ ...base, other: true, number: '2', emptyMeansSkip: true })).toEqual({
      kind: 'number',
      value: 2,
    });
    expect(levelNext({ ...base, other: true, note: 'B2', emptyMeansSkip: true })).toEqual({
      kind: 'note',
      note: 'B2',
    });
  });

  it('a number clears the words and the words clear the number (never both)', () => {
    expect(exclusiveLevelInput('number', '2', { number: '', note: 'Módulo 3' })).toEqual({
      number: '2',
      note: '',
    });
    expect(exclusiveLevelInput('note', 'B2', { number: '2', note: '' })).toEqual({
      number: '',
      note: 'B2',
    });
    expect(
      levelNext({
        picked: null,
        number: '2',
        note: 'B2',
        other: true,
        currentLevel: null,
        noun: 'Nivel',
      }).kind,
    ).toBe('error');
  });

  it('the confirmation shows the level when it was given (a number in "nivel" words, or the words) and no line when not', () => {
    const base = {
      ...emptyWizard,
      type: 'OTHER_ACADEMIC' as const,
      name: 'Técnico en Sistemas',
      period: { name: 'Módulo 1', startDate: '2026-08-03', endDate: '2026-11-28' },
    };
    expect(levelLabel('OTHER_ACADEMIC', { studyLevel: 2, studyLevelNote: null })).toBe('Nivel 2');
    expect(levelLabel('OTHER_ACADEMIC', { studyLevel: null, studyLevelNote: 'B2' })).toBe('B2');
    expect(levelLabel('OTHER_ACADEMIC', none)).toBeNull();
    // and the request carries a number OR a note, or neither
    expect(
      toSetupRequest({ ...base, level: { studyLevel: 2, studyLevelNote: null } }).period,
    ).toMatchObject({ studyLevel: 2 });
    const note = toSetupRequest({
      ...base,
      level: { studyLevel: null, studyLevelNote: 'B2' },
    }).period;
    expect(note).toMatchObject({ studyLevelNote: 'B2' });
    expect(note).not.toHaveProperty('studyLevel');
    const nothing = toSetupRequest({ ...base, level: none }).period;
    expect(nothing).not.toHaveProperty('studyLevel');
    expect(nothing).not.toHaveProperty('studyLevelNote');
  });

  it('going Back keeps what was written: the level step starts from the saved level', () => {
    const src = readFileSync(
      new URL('../pages/studies/AddStudyDialog.tsx', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/current=\{data\.level\}/);
    expect(src).toMatch(/level: d\.level/); // changing the kind of study does not throw the level away
    expect(src).not.toMatch(/level: type === 'OTHER_ACADEMIC'/);
  });
});
