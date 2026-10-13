import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type {
  AcademicPeriod,
  OnboardingStatus,
  PrimaryUse,
  Profile,
  PublicUser,
  Subject,
} from '@planner/core';
import { periodsKey, subjectsKey } from '../academic/useAcademic';
import { ME_KEY } from '../auth/useAuth';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PROFILE_KEY } from '../profile/useProfile';
import { profileNotice, ProfileNotice } from '../profile/ProfileNotice';
import { FinalStep } from './FinalStep';
import { LevelStep } from './LevelStep';
import {
  SUBJECT_CHIPS_MAX,
  USE_OPTIONS,
  addChip,
  defaultPeriodName,
  exclusiveLevelInput,
  flowFor,
  levelCopy,
  levelNext,
  onboardingStep,
  periodHeading,
  previousStep,
  programCopy,
  programNext,
  progressSteps,
  removeChip,
  subjectsTitle,
  type OnboardingFacts,
  type OnboardingStep,
} from './onboardingModel';
import { PeriodStep } from './PeriodStep';
import { PrimaryUseStep } from './PrimaryUseStep';
import { ProgramStep } from './ProgramStep';
import { SubjectsStep } from './SubjectsStep';

const QUESTION = '¿Para qué quieres usar Academic Planner?';
const PERIOD_ID = '5f0c3a4e-9a52-4c1e-8f6a-3f1d2c4b6a70';
const USER: PublicUser = {
  id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
  name: 'Ana',
  email: 'ana@example.com',
  timezone: 'America/Bogota',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const profile = (
  primaryUse: PrimaryUse | null,
  onboardingStatus: OnboardingStatus,
  programName: string | null = null,
): Profile => ({
  primaryUse,
  programName,
  programKey: null,
  onboardingStatus,
});
const period = (over: Partial<AcademicPeriod> = {}): AcademicPeriod => ({
  id: PERIOD_ID,
  name: 'P',
  startDate: '2026-08-03',
  endDate: '2026-11-28',
  isCurrent: true,
  studyTrackId: null,
  studyLevel: null,
  studyLevelNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const subject = (name: string): Subject =>
  ({
    id: `00000000-0000-4000-8000-0000000000${name.length.toString().padStart(2, '0')}`,
    periodId: PERIOD_ID,
    name,
    professor: null,
    color: '#3B82F6',
    description: null,
    educationContext: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }) as Subject;

/** The page as the server would render it with these answers already in the cache. */
function page(p: Profile | undefined, periods: AcademicPeriod[] | undefined, subjects?: Subject[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_KEY, USER);
  if (p) client.setQueryData(PROFILE_KEY, p);
  if (periods) client.setQueryData(periodsKey, periods);
  if (subjects) client.setQueryData(subjectsKey(PERIOD_ID), subjects);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StaticRouter location="/onboarding">
        <OnboardingPage />
      </StaticRouter>
    </QueryClientProvider>,
  );
}
const h1 = (html: string) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];

const facts = (
  use: PrimaryUse | null,
  status: OnboardingStatus,
  opts: {
    period?: boolean;
    program?: string | null;
    level?: number | null;
    decided?: string[];
  } = {},
): OnboardingFacts => ({
  profile: { primaryUse: use, onboardingStatus: status, programName: opts.program ?? null },
  period: opts.period === false ? null : { studyLevel: opts.level ?? null, studyLevelNote: null },
  decided: new Set(opts.decided ?? []),
});

describe('the optional steps of each use', () => {
  it('university: program, level, subjects; school: level, subjects; other: program, subjects; teacher: subjects; personal: none', () => {
    expect(flowFor('UNIVERSITY_STUDENT')).toEqual(['PROGRAM', 'LEVEL', 'SUBJECTS']);
    expect(flowFor('SCHOOL_STUDENT')).toEqual(['LEVEL', 'SUBJECTS']);
    expect(flowFor('OTHER_STUDENT')).toEqual(['PROGRAM', 'SUBJECTS']);
    expect(flowFor('TEACHER')).toEqual(['SUBJECTS']);
    expect(flowFor('PERSONAL')).toEqual([]);
    expect(flowFor(null)).toEqual([]);
  });

  it('other study has no level question on purpose (it would be a question without a clear meaning)', () => {
    expect(flowFor('OTHER_STUDENT')).not.toContain('LEVEL');
  });

  it('the quiet progress names only the steps that exist for this student', () => {
    expect(progressSteps('PERSONAL')).toEqual(['USE', 'PERIOD', 'FINAL']);
    expect(progressSteps('SCHOOL_STUDENT')).toEqual([
      'USE',
      'PERIOD',
      'LEVEL',
      'SUBJECTS',
      'FINAL',
    ]);
    expect(progressSteps(null)).toEqual(['USE', 'PERIOD', 'FINAL']);
  });
});

describe('which step comes next (derived from the server plus what was decided here)', () => {
  const next = (f: OnboardingFacts) => onboardingStep(f);

  it('a new account: the question, then the period', () => {
    expect(next(facts(null, 'NOT_STARTED', { period: false }))).toBe('USE');
    expect(next(facts('UNIVERSITY_STUDENT', 'IN_PROGRESS', { period: false }))).toBe('PERIOD');
    expect(next(facts(null, 'SKIPPED', { period: false }))).toBe('PERIOD'); // skipped: the period is still required
  });

  it('university walks program -> level -> subjects -> final, each once it is answered or skipped', () => {
    const base = ['UNIVERSITY_STUDENT', 'IN_PROGRESS'] as const;
    expect(next(facts(...base))).toBe('PROGRAM');
    expect(next(facts(...base, { program: 'Medicina' }))).toBe('LEVEL');
    expect(next(facts(...base, { program: 'Medicina', level: 4 }))).toBe('SUBJECTS');
    expect(next(facts(...base, { decided: ['PROGRAM'] }))).toBe('LEVEL'); // skipped, not answered
    expect(next(facts(...base, { decided: ['PROGRAM', 'LEVEL'] }))).toBe('SUBJECTS');
    expect(next(facts(...base, { decided: ['PROGRAM', 'LEVEL', 'SUBJECTS'] }))).toBe('FINAL');
  });

  it('school: level, then subjects, then final', () => {
    const base = ['SCHOOL_STUDENT', 'IN_PROGRESS'] as const;
    expect(next(facts(...base))).toBe('LEVEL');
    expect(next(facts(...base, { level: 10 }))).toBe('SUBJECTS');
    expect(next(facts(...base, { level: 10, decided: ['SUBJECTS'] }))).toBe('FINAL');
  });

  it('teacher goes to the subjects, other study to program then subjects, personal straight to the final', () => {
    expect(next(facts('TEACHER', 'IN_PROGRESS'))).toBe('SUBJECTS');
    expect(next(facts('OTHER_STUDENT', 'IN_PROGRESS'))).toBe('PROGRAM');
    expect(next(facts('OTHER_STUDENT', 'IN_PROGRESS', { decided: ['PROGRAM'] }))).toBe('SUBJECTS');
    expect(next(facts('PERSONAL', 'IN_PROGRESS'))).toBe('FINAL');
  });

  it('a skipped profile goes from the period to the final (nothing else makes sense without a use)', () => {
    expect(next(facts(null, 'SKIPPED'))).toBe('USE'); // an existing student who opens it by hand is asked again...
    expect(next(facts(null, 'SKIPPED', { decided: ['USE'] }))).toBe('FINAL'); // ...unless they just skipped it
  });

  it('a completed wizard is never chased for optional fields that are still empty', () => {
    expect(next(facts('UNIVERSITY_STUDENT', 'COMPLETED'))).toBe('DONE');
    expect(next(facts('SCHOOL_STUDENT', 'COMPLETED', { level: null }))).toBe('DONE');
  });

  it('an existing student (period, no answer, never started) can start it by hand: the question first', () => {
    expect(next(facts(null, 'NOT_STARTED'))).toBe('USE');
  });

  it('a note counts as an answer to the level', () => {
    const f = facts('SCHOOL_STUDENT', 'IN_PROGRESS');
    expect(next(f)).toBe('LEVEL');
    expect(next({ ...f, period: { studyLevel: null, studyLevelNote: 'Internado' } })).toBe(
      'SUBJECTS',
    );
  });
});

describe('going back', () => {
  const back = (step: OnboardingStep, f: OnboardingFacts) => previousStep(step, f);

  it('goes to the step before, through the flow of that use', () => {
    const f = facts('UNIVERSITY_STUDENT', 'IN_PROGRESS');
    expect(back('FINAL', f)).toBe('SUBJECTS');
    expect(back('SUBJECTS', f)).toBe('LEVEL');
    expect(back('LEVEL', f)).toBe('PROGRAM');
    expect(back('PROGRAM', f)).toBe('USE'); // with a period it does not go back to creating one
    expect(back('USE', f)).toBeNull();
  });

  it('before the period exists, the period can go back to the question; personal goes final -> use', () => {
    expect(back('PERIOD', facts('TEACHER', 'IN_PROGRESS', { period: false }))).toBe('USE');
    expect(back('FINAL', facts('PERSONAL', 'IN_PROGRESS'))).toBe('USE');
  });
});

describe('the words that change with the use (only words: the domain is the same)', () => {
  it('period heading per use, and a neutral one without an answer', () => {
    expect(periodHeading('UNIVERSITY_STUDENT')).toBe('Tu semestre actual');
    expect(periodHeading('SCHOOL_STUDENT')).toBe('Tu periodo escolar');
    expect(periodHeading('OTHER_STUDENT')).toBe('Tu periodo de estudio');
    expect(periodHeading('TEACHER')).toBe('Tu periodo actual');
    expect(periodHeading('PERSONAL')).toBe('Tu planificación actual');
    expect(periodHeading(null)).toBe('Tu periodo actual');
  });

  it('the program question: careers for the university, "what are you studying" for the rest', () => {
    expect(programCopy('UNIVERSITY_STUDENT').title).toBe('¿Qué estudias?');
    expect(programCopy('OTHER_STUDENT').title).toBe('¿Qué estás estudiando?');
  });

  it('the level question and its quick options: 10 semesters, 11 grades (the domain accepts 1 to 99)', () => {
    expect(levelCopy('UNIVERSITY_STUDENT')).toMatchObject({
      title: '¿En qué semestre estás?',
      options: 10,
    });
    expect(levelCopy('SCHOOL_STUDENT')).toMatchObject({
      title: '¿En qué grado estás?',
      options: 11,
    });
  });

  it('the subjects question per use', () => {
    expect(subjectsTitle('UNIVERSITY_STUDENT')).toBe('¿Qué materias estás cursando?');
    expect(subjectsTitle('SCHOOL_STUDENT')).toBe('¿Qué materias ves?');
    expect(subjectsTitle('OTHER_STUDENT')).toBe('¿Qué materias o módulos tienes?');
    expect(subjectsTitle('TEACHER')).toBe('¿Qué materias o cursos impartes?');
  });

  it('offers a name for the period (a personal one is its own), never dates', () => {
    expect(defaultPeriodName('PERSONAL')).toBe('Mi planificación');
    expect(defaultPeriodName('UNIVERSITY_STUDENT', new Date('2026-10-12T12:00:00Z'))).toBe(
      'Segundo semestre 2026',
    );
  });
});

describe('step 1 and 2 (as in P0-4a)', () => {
  const useHtml = (over: Partial<Parameters<typeof PrimaryUseStep>[0]> = {}) =>
    renderToStaticMarkup(
      <PrimaryUseStep
        selected={null}
        pending={false}
        onPick={() => {}}
        onSkip={() => {}}
        {...over}
      />,
    );

  it('five options in order, as real buttons with an SVG icon and no emoji, plus the skip', () => {
    const out = useHtml();
    expect(USE_OPTIONS.map((o) => o.value)).toEqual([
      'UNIVERSITY_STUDENT',
      'SCHOOL_STUDENT',
      'TEACHER',
      'OTHER_STUDENT',
      'PERSONAL',
    ]);
    expect([...out.matchAll(/<button[^>]*>/g)]).toHaveLength(6);
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out).toContain('Omitir por ahora');
  });

  it('with an answer already saved, "skip" only goes on', () => {
    expect(useHtml({ selected: 'SCHOOL_STUDENT', current: 'SCHOOL_STUDENT' })).toContain(
      'Seguir sin cambiar',
    );
  });

  it('a failure is an alert and the choice stays marked', () => {
    const out = useHtml({ selected: 'UNIVERSITY_STUDENT', error: 'No se pudo guardar.' });
    expect(out).toContain('role="alert"');
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('the period step keeps the three fields and never guesses the dates', () => {
    const out = renderToStaticMarkup(
      <PeriodStep primaryUse="PERSONAL" pending={false} onSubmit={() => {}} />,
    );
    for (const label of ['Nombre del periodo', 'Inicio', 'Fin']) {
      expect(out).toContain(`>${label}</label>`);
    }
    expect(out).toContain('value="Mi planificación"');
    expect(out).toMatch(/id="startDate"[^>]*value=""/);
  });
});

describe('the program step', () => {
  const html = (over: Partial<Parameters<typeof ProgramStep>[0]> = {}) =>
    renderToStaticMarkup(
      <ProgramStep
        primaryUse="UNIVERSITY_STUDENT"
        currentName={null}
        pending={false}
        onPickCatalog={() => {}}
        onSaveCustom={() => {}}
        onSkip={() => {}}
        {...over}
      />,
    );

  it('has a real label, the way out for a program that is not in the catalog, "Siguiente" and "Ahora no"; no list until something is typed', () => {
    const out = html();
    expect(out).toMatch(/<label[^>]*for="program"[^>]*>Carrera o programa<\/label>/);
    expect(out).toContain('Mi carrera no aparece');
    expect(out).toContain('>Siguiente<');
    expect(out).toContain('Ahora no');
    expect(out).not.toMatch(/Omitir este paso|>Guardar</);
    expect(out).not.toContain('Coincidencias'); // the catalog is never dumped
  });

  it('what is typed is searched in the catalog, ignoring case and accents', () => {
    const out = html({ currentName: 'PSICOLOGIA' });
    expect(out).toContain('Coincidencias');
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>Psicología<\/button>/);
    expect(html({ currentName: 'zzzz' })).not.toContain('Coincidencias');
  });

  it('shows what the server already has', () => {
    expect(html({ currentName: 'Medicina' })).toContain('Ahora tienes:');
  });

  it('other study: the free text is the main way ("Siguiente" from the start, no "my career is not here")', () => {
    const out = html({ primaryUse: 'OTHER_STUDENT' });
    expect(out).toMatch(/Curso o programa/);
    expect(out).toContain('>Siguiente<');
    expect(out).not.toContain('Mi carrera no aparece');
  });

  it('a failure says so as an alert; while saving everything waits', () => {
    expect(html({ error: 'No se pudo guardar.' })).toContain('role="alert"');
    expect(html({ pending: true, currentName: 'Medicina' })).toMatch(/disabled=""/);
  });
});

describe('the program step: what "Siguiente" does', () => {
  const base = { picked: null, query: '', currentName: null, custom: false, matches: 0 };
  const psico = { key: 'psicologia', name: 'Psicología' } as never;

  it('a program of their own (custom) + Siguiente saves what was written, with no key', () => {
    expect(programNext({ ...base, custom: true, query: '  Medicina del Deporte ' })).toEqual({
      kind: 'custom',
      name: 'Medicina del Deporte',
    });
  });

  it('a marked catalog entry + Siguiente saves it (by key), whatever else is typed', () => {
    expect(programNext({ ...base, picked: psico, query: 'psico', matches: 1 })).toEqual({
      kind: 'catalog',
      entry: psico,
    });
  });

  it('typed words that match the catalog, with nothing marked, ask for a tap instead of guessing', () => {
    expect(programNext({ ...base, query: 'psico', matches: 1 }).kind).toBe('error');
  });

  it('typed words the catalog does not know are saved as their own program', () => {
    expect(programNext({ ...base, query: 'Cerámica', matches: 0 })).toEqual({
      kind: 'custom',
      name: 'Cerámica',
    });
  });

  it('nothing written: an error that points to "Ahora no" (it never saves an empty name)', () => {
    const r = programNext({ ...base, query: '   ' });
    expect(r.kind).toBe('error');
    expect((r as { message: string }).message).toContain('Ahora no');
  });

  it('what the server already has, left as it is: Siguiente only moves on; a too long name is refused', () => {
    expect(programNext({ ...base, query: 'Psicología', currentName: 'Psicología' })).toEqual({
      kind: 'skip',
    });
    expect(programNext({ ...base, custom: true, query: 'x'.repeat(81) }).kind).toBe('error');
  });
});

describe('the level step', () => {
  const html = (over: Partial<Parameters<typeof LevelStep>[0]> = {}) =>
    renderToStaticMarkup(
      <LevelStep
        primaryUse="UNIVERSITY_STUDENT"
        current={{ studyLevel: null, studyLevelNote: null }}
        pending={false}
        onPickNumber={() => {}}
        onSaveNote={() => {}}
        onSkip={() => {}}
        {...over}
      />,
    );

  it('university: 1 to 10 and "Otro", real buttons with a name; none is pressed until chosen', () => {
    const out = html();
    for (let n = 1; n <= 10; n++) expect(out).toContain(`aria-label="Semestre ${n}"`);
    expect(out).not.toContain('aria-label="Semestre 11"');
    expect(out).toContain('>Otro<');
    expect(out.match(/aria-pressed="true"/g)).toBeNull();
    expect(out).toContain('>Siguiente<');
    expect(out).toContain('Ahora no');
    expect(out).not.toMatch(/Omitir este paso|>Guardar</);
  });

  it('school: 1 to 11, called grade', () => {
    const out = html({ primaryUse: 'SCHOOL_STUDENT' });
    expect(out).toContain('aria-label="Grado 11"');
    expect(out).not.toContain('aria-label="Grado 12"');
  });

  it('marks the saved one as pressed', () => {
    const out = html({ current: { studyLevel: 4, studyLevelNote: null } });
    expect(out).toMatch(/aria-label="Semestre 4"[^>]*aria-pressed="true"/);
    expect(out).not.toContain('level-number'); // "Otro" is closed
  });

  it('a level beyond the quick ones, or a note, opens "Otro" with its value (the domain is not limited to 10)', () => {
    const big = html({ current: { studyLevel: 12, studyLevelNote: null } });
    expect(big).toContain('id="level-number"');
    expect(big).toContain('Usa una sola opción.');
    expect(big).toContain('value="12"');
    const note = html({ current: { studyLevel: null, studyLevelNote: 'Internado' } });
    expect(note).toContain('id="level-note"');
    expect(note).toContain('value="Internado"');
  });

  it('a failure is an alert', () => {
    expect(html({ error: 'No se pudo guardar.' })).toContain('role="alert"');
  });
});

describe('the level step: what "Siguiente" does', () => {
  const base = {
    other: false,
    picked: null,
    number: '',
    note: '',
    currentLevel: null,
    noun: 'Semestre',
  };

  it('a number is only MARKED when tapped: nothing is saved until Siguiente, which then saves that number', () => {
    expect(levelNext({ ...base, picked: 4 })).toEqual({ kind: 'number', value: 4 });
  });

  it('nothing marked: an error that points to "Ahora no"', () => {
    const r = levelNext(base);
    expect(r.kind).toBe('error');
    expect((r as { message: string }).message).toContain('Ahora no');
  });

  it('the level the period already has, left as it is, only moves on', () => {
    expect(levelNext({ ...base, picked: 4, currentLevel: 4 })).toEqual({ kind: 'skip' });
  });

  it('"Otro": a number up to 99, or a description; each is saved by Siguiente', () => {
    expect(levelNext({ ...base, other: true, number: ' 12 ' })).toEqual({
      kind: 'number',
      value: 12,
    });
    expect(levelNext({ ...base, other: true, note: ' Internado ' })).toEqual({
      kind: 'note',
      note: 'Internado',
    });
    expect(levelNext({ ...base, other: true, number: '100' }).kind).toBe('error');
    expect(levelNext({ ...base, other: true, number: '1a' }).kind).toBe('error');
    expect(levelNext({ ...base, other: true }).kind).toBe('error');
  });

  it('typing a number empties the description, and typing a description empties the number', () => {
    expect(exclusiveLevelInput('number', '12', { number: '', note: 'Internado' })).toEqual({
      number: '12',
      note: '',
    });
    expect(exclusiveLevelInput('note', 'Internado', { number: '12', note: '' })).toEqual({
      number: '',
      note: 'Internado',
    });
  });

  it('erasing a field does not bring the other one back or erase it', () => {
    expect(exclusiveLevelInput('number', '', { number: '1', note: '' })).toEqual({
      number: '',
      note: '',
    });
    expect(exclusiveLevelInput('note', '', { number: '', note: 'x' })).toEqual({
      number: '',
      note: '',
    });
  });

  it('if both ever arrive together the screen still refuses them (the domain refuses them as well)', () => {
    const r = levelNext({ ...base, other: true, number: '12', note: 'Internado' });
    expect(r).toEqual({ kind: 'error', message: 'Escribe solo uno: el número o la descripción.' });
  });
});

describe('quick subjects: the chips', () => {
  it('adds a trimmed name, in order', () => {
    expect(addChip([], [], '  Farmacología ')).toEqual({ chips: ['Farmacología'] });
    expect(addChip(['Farmacología'], [], 'Semiología').chips).toEqual([
      'Farmacología',
      'Semiología',
    ]);
  });

  it('collapses inner spaces and ignores an empty or blank entry', () => {
    expect(addChip([], [], 'Bases   de  Datos').chips).toEqual(['Bases de Datos']);
    expect(addChip(['A'], [], '   ')).toEqual({ chips: ['A'] });
  });

  it('refuses a duplicate by normalized name (case, accents, spaces) and says why', () => {
    const r = addChip(['Farmacología'], [], ' FARMACOLOGIA ');
    expect(r.chips).toEqual(['Farmacología']);
    expect(r.error).toBe('Ya la agregaste.');
  });

  it('refuses one the period already has, and says so', () => {
    const r = addChip([], ['Anatomía'], 'anatomia');
    expect(r.chips).toEqual([]);
    expect(r.error).toBe('Ya tienes esa materia en este periodo.');
  });

  it('stops at the batch limit, with a message', () => {
    const full = Array.from({ length: SUBJECT_CHIPS_MAX }, (_, i) => `Materia ${i}`);
    const r = addChip(full, [], 'Una más');
    expect(r.chips).toHaveLength(SUBJECT_CHIPS_MAX);
    expect(r.error).toContain(String(SUBJECT_CHIPS_MAX));
    expect(addChip(full.slice(1), [], 'Una más').chips).toHaveLength(SUBJECT_CHIPS_MAX);
  });

  it('refuses a name that is too long or has a NUL', () => {
    expect(addChip([], [], 'x'.repeat(101)).error).toMatch(/demasiado largo/);
    expect(addChip([], [], 'Ana\u0000tomía').error).toMatch(/no válidos/);
  });

  it('removes a chip', () => {
    expect(removeChip(['A', 'B', 'C'], 'B')).toEqual(['A', 'C']);
  });
});

describe('the subjects step', () => {
  const html = (over: Partial<Parameters<typeof SubjectsStep>[0]> = {}) =>
    renderToStaticMarkup(
      <SubjectsStep
        primaryUse="UNIVERSITY_STUDENT"
        existing={[]}
        chips={[]}
        onChips={() => {}}
        pending={false}
        onConfirm={() => {}}
        {...over}
      />,
    );

  it('an empty list: one field with a real label, an Agregar button and a single "Siguiente" (no second button that does the same)', () => {
    const out = html();
    expect(out).toMatch(/<label[^>]*for="subject-name"[^>]*>Escribe una materia<\/label>/);
    expect(out).toContain('Pulsa Enter para agregarla.');
    expect(out).toContain('>Siguiente<');
    expect(out).not.toMatch(/Hacerlo después|Ahora no|Omitir|Continuar/);
    expect(out).not.toMatch(/Agregar \d+ materia/);
    // no teacher, color, description or type: one field only
    expect(out.match(/<input/g)).toHaveLength(1);
    const words = out.replaceAll(/ (class|style)="[^"]*"/g, ''); // the visible words, not CSS class names
    expect(words).not.toMatch(/profesor|color|descripci[oó]n|tipo/i);
  });

  it('every chip has its own named remove button, and the page says how many "Siguiente" will add', () => {
    const out = html({ chips: ['Farmacología', 'Semiología', 'Bioestadística'] });
    for (const n of ['Farmacología', 'Semiología', 'Bioestadística']) {
      expect(out).toContain(`aria-label="Quitar ${n}"`);
    }
    expect(out).toContain('agregarán 3 materias');
    expect(out).toContain('>Siguiente<');
    expect(html({ chips: ['Una'] })).toContain('agregará 1 materia');
  });

  it('shows the subjects the period already has as already added, apart from the new ones', () => {
    const out = html({ existing: ['Anatomía', 'Redes'], chips: ['Nueva'] });
    expect(out).toContain('Ya tienes en este periodo');
    expect(out).toContain('Materias que ya tienes');
    expect(out).toContain('Anatomía');
    expect(out).not.toContain('aria-label="Quitar Anatomía"'); // they are not part of the batch
    expect(out).toContain('Agregar otra materia');
  });

  it('with existing subjects and nothing new, it is the same single "Siguiente"', () => {
    const out = html({ existing: ['Anatomía'] });
    expect(out).toContain('>Siguiente<');
    expect(out).not.toMatch(/agregar[áa]n? \d|Continuar/);
  });

  it('a failure keeps the names and says to try again; while saving everything waits', () => {
    const failed = html({ chips: ['A'], error: 'No se pudo guardar.' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('aria-label="Quitar A"');
    const waiting = html({ chips: ['A'], pending: true });
    expect(waiting).toContain('Guardando…');
    expect(waiting).toMatch(
      /aria-label="Quitar A"[^>]*disabled=""|disabled=""[^>]*aria-label="Quitar A"/,
    );
  });

  it('at the limit it says so', () => {
    const full = Array.from({ length: SUBJECT_CHIPS_MAX }, (_, i) => `M${i}`);
    expect(html({ chips: full })).toContain('máximo');
  });
});

describe('the final step', () => {
  const html = (over: Partial<Parameters<typeof FinalStep>[0]> = {}) =>
    renderToStaticMarkup(
      <FinalStep pending={false} onImport={() => {}} onHome={() => {}} {...over} />,
    );

  it('two ways out, in this order, and the reassurance', () => {
    const out = html();
    expect(out.indexOf('Importar mi horario')).toBeGreaterThan(-1);
    expect(out.indexOf('Importar mi horario')).toBeLessThan(out.indexOf('Ir al Inicio'));
    expect(out).toContain('Puedes cambiar todo esto después.');
    expect(out).not.toContain('role="status"');
  });

  it('says what the subjects step did, simply', () => {
    expect(html({ subjects: { created: 3, reused: 0 } })).toContain('3 materias agregadas');
    expect(html({ subjects: { created: 1, reused: 2 } })).toContain(
      '1 materia agregada · 2 ya estaban en tu periodo',
    );
  });

  it('a failure is an alert; while leaving the buttons wait', () => {
    expect(html({ error: 'No se pudo guardar.' })).toContain('role="alert"');
    expect(html({ pending: true }).match(/disabled=""/g)).toHaveLength(2);
  });
});

describe('the page, with what the server already knows', () => {
  it('a new account sees the question', () => {
    const out = page(profile(null, 'NOT_STARTED'), []);
    expect(h1(out)).toBe(QUESTION);
    expect(out.match(/<h1/g)).toHaveLength(1);
  });

  it('answered and without a period: the period, with its words', () => {
    expect(h1(page(profile('UNIVERSITY_STUDENT', 'IN_PROGRESS'), []))).toBe('Tu semestre actual');
    expect(h1(page(profile(null, 'SKIPPED'), []))).toBe('Tu periodo actual');
  });

  it('with the period: university continues at the program, school at the level, teacher at the subjects, personal at the end', () => {
    const p = [period()];
    expect(h1(page(profile('UNIVERSITY_STUDENT', 'IN_PROGRESS'), p))).toBe('¿Qué estudias?');
    expect(h1(page(profile('SCHOOL_STUDENT', 'IN_PROGRESS'), p))).toBe('¿En qué grado estás?');
    expect(h1(page(profile('OTHER_STUDENT', 'IN_PROGRESS'), p))).toBe('¿Qué estás estudiando?');
    expect(h1(page(profile('TEACHER', 'IN_PROGRESS'), p, []))).toBe(
      '¿Qué materias o cursos impartes?',
    );
    expect(h1(page(profile('PERSONAL', 'IN_PROGRESS'), p))).toBe('Listo para empezar');
  });

  it('a program already saved moves university on to the level; a level already saved to the subjects', () => {
    expect(h1(page(profile('UNIVERSITY_STUDENT', 'IN_PROGRESS', 'Medicina'), [period()]))).toBe(
      '¿En qué semestre estás?',
    );
    expect(
      h1(
        page(
          profile('UNIVERSITY_STUDENT', 'IN_PROGRESS', 'Medicina'),
          [period({ studyLevel: 4 })],
          [],
        ),
      ),
    ).toBe('¿Qué materias estás cursando?');
  });

  it('the subjects step shows what the period already has, as already added', () => {
    const out = page(
      profile('TEACHER', 'IN_PROGRESS'),
      [period()],
      [subject('Anatomía'), subject('Redes')],
    );
    expect(out).toContain('Ya tienes en este periodo');
    expect(out).toContain('Anatomía');
  });

  it('an existing student (period, no answer) can open it by hand: the question, no period form', () => {
    const out = page(profile(null, 'NOT_STARTED'), [period()]);
    expect(h1(out)).toBe(QUESTION);
    expect(out).not.toContain('Nombre del periodo');
  });

  it('a completed wizard is not shown again (it leaves for the dashboard), whatever is still empty', () => {
    expect(page(profile('UNIVERSITY_STUDENT', 'COMPLETED'), [period()])).not.toContain('<h1');
  });

  it('shows the quiet progress: the current step by name, the others as marks with a hidden name', () => {
    const out = page(profile('UNIVERSITY_STUDENT', 'IN_PROGRESS'), [period()]);
    expect(out).toMatch(/<li[^>]*aria-current="step"[^>]*>Programa<\/li>/);
    expect(out).toContain('<span class="sr-only">Materias</span>');
    expect(out).not.toMatch(/\d de \d|paso \d/i); // no promise of a count
  });

  it('while loading there is a message, never a blank page', () => {
    expect(page(undefined, undefined)).toContain('Cargando…');
  });
});

describe('the profile notice on the Home', () => {
  it('never started: "Completa tu perfil"; in progress: "Continúa configurando tu perfil"', () => {
    expect(profileNotice(profile(null, 'NOT_STARTED'))).toEqual({
      text: 'Completa tu perfil',
      cta: 'Completar',
    });
    expect(profileNotice(profile('SCHOOL_STUDENT', 'IN_PROGRESS'))?.text).toBe(
      'Continúa configurando tu perfil',
    );
  });

  it('skipped or completed: nothing (SKIPPED means do not insist)', () => {
    expect(profileNotice(profile(null, 'SKIPPED'))).toBeNull();
    expect(profileNotice(profile('UNIVERSITY_STUDENT', 'COMPLETED'))).toBeNull();
  });

  const render = (p?: Profile) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (p) client.setQueryData(PROFILE_KEY, p);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StaticRouter location="/dashboard">
          <ProfileNotice />
        </StaticRouter>
      </QueryClientProvider>,
    );
  };

  it('is one quiet line with a link to the onboarding (no modal, no alert)', () => {
    const out = render(profile(null, 'NOT_STARTED'));
    expect(out).toContain('Completa tu perfil');
    expect(out).toContain('href="/onboarding"');
    expect(out).not.toMatch(/role="(alert|dialog|alertdialog)"/);
  });

  it('is absent when skipped, completed, or while the profile is unknown', () => {
    expect(render(profile(null, 'SKIPPED'))).toBe('');
    expect(render(profile('PERSONAL', 'COMPLETED'))).toBe('');
    expect(render(undefined)).toBe('');
  });
});
