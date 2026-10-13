import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  login,
  PASSWORD,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * The educational onboarding, complete (P0-4a + P0-4b): right after the registration, one question per screen — what the
 * app is for, the period, then the optional steps of that use (program, level, quick subjects) and a small last screen with
 * two ways out. Always skippable, saved on the server as it goes, resumable, and never forced on a student who already has a
 * period. The step is derived from what the server knows; the subjects typed and not created yet and the skipped steps live in
 * a local draft.
 */

const QUESTION = '¿Para qué quieres usar Academic Planner?';
const FINAL = 'Listo para empezar';

interface ProfileDto {
  primaryUse: string | null;
  programName: string | null;
  programKey: string | null;
  onboardingStatus: string;
}
interface PeriodDto {
  id: string;
  isCurrent: boolean;
  studyLevel: number | null;
  studyLevelNote: string | null;
}
interface SubjectDto {
  id: string;
  name: string;
  educationContext: string | null;
  periodId: string;
}
const get = async <T>(page: Page, path: string, key: string) =>
  (await (await page.request.get(path)).json())[key] as T;
const profile = (page: Page) => get<ProfileDto>(page, '/api/profile', 'profile');
const periods = (page: Page) => get<PeriodDto[]>(page, '/api/periods', 'periods');
const subjects = (page: Page) => get<SubjectDto[]>(page, '/api/subjects', 'subjects');
const draftKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(':onboarding')));

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const use = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(title) });
const fillPeriod = async (page: Page, start = '2026-08-03', end = '2026-11-28') => {
  await page.getByLabel('Inicio', { exact: true }).fill(start);
  await page.getByLabel('Fin', { exact: true }).fill(end);
  await page.getByRole('button', { name: 'Siguiente' }).click();
};
const addSubjects = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.locator('#subject-name').fill(name);
    await page.locator('#subject-name').press('Enter');
    await expect(page.getByRole('button', { name: `Quitar ${name}` })).toBeVisible();
  }
};
const START = async (page: Page, title: string) => {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await use(page, title).click();
};
const finishHome = async (page: Page) => {
  await expect(h1(page, FINAL)).toBeVisible();
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
};

const USES: [title: string, value: string, heading: string][] = [
  ['Universidad', 'UNIVERSITY_STUDENT', 'Tu semestre actual'],
  ['Colegio', 'SCHOOL_STUDENT', 'Tu periodo escolar'],
  ['Soy docente', 'TEACHER', 'Tu periodo actual'],
  ['Otro tipo de estudio', 'OTHER_STUDENT', 'Tu periodo de estudio'],
  ['Organización personal', 'PERSONAL', 'Tu planificación actual'],
];

test('registering goes straight to the onboarding, with one question and the five options', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(h1(page, QUESTION)).toBeVisible();
  for (const [title] of USES) await expect(use(page, title)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Omitir por ahora' })).toBeVisible();
  expect(await profile(page)).toEqual({
    primaryUse: null,
    programName: null,
    programKey: null,
    onboardingStatus: 'NOT_STARTED',
  });
  expect(await periods(page)).toEqual([]);
  assertClean();
});

for (const [title, value, heading] of USES) {
  test(`choosing "${title}" saves it and changes the words of the period step`, async ({
    page,
  }) => {
    const assertClean = watch(page);
    await START(page, title);
    await expect(h1(page, heading)).toBeVisible();
    expect(await profile(page)).toMatchObject({
      primaryUse: value,
      onboardingStatus: 'IN_PROGRESS',
    });
    const name = page.getByLabel('Nombre del periodo');
    if (value === 'PERSONAL') await expect(name).toHaveValue('Mi planificación');
    else await expect(name).toHaveValue(/semestre \d{4}$/);
    await expect(page.getByLabel('Inicio', { exact: true })).toHaveValue(''); // dates are never guessed
    await expect(page.getByLabel('Fin', { exact: true })).toHaveValue('');
    assertClean();
  });
}

test('UNIVERSITY, complete: program from the catalog, semester, three subjects, and out to the Home', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);

  // program: searched offline, accents and case ignored; the catalog is never dumped
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Coincidencias' })).toHaveCount(0);
  await page.getByLabel('Carrera o programa').fill('PSICOLOGIA');
  await page.getByRole('button', { name: 'Psicología', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Psicología', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // semester
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  await page.getByRole('button', { name: 'Semestre 4' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // quick subjects
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  await addSubjects(page, ['Farmacología', 'Semiología', 'Bioestadística']);
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(h1(page, FINAL)).toBeVisible();
  await expect(page.getByText('3 materias agregadas')).toBeVisible();
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  expect(await profile(page)).toEqual({
    primaryUse: 'UNIVERSITY_STUDENT',
    programKey: 'psicologia',
    programName: 'Psicología', // derived by the server from the key
    onboardingStatus: 'COMPLETED',
  });
  const [current] = await periods(page);
  expect(current).toMatchObject({ isCurrent: true, studyLevel: 4, studyLevelNote: null });
  const created = await subjects(page);
  expect(created.map((s) => s.name).sort()).toEqual([
    'Bioestadística',
    'Farmacología',
    'Semiología',
  ]);
  expect(created.every((s) => s.educationContext === 'UNIVERSITY')).toBe(true);
  expect(await draftKeys(page)).toEqual([]); // the draft is gone
  await expect(page.getByRole('region', { name: 'Tu perfil' })).toHaveCount(0);
  await page.goto('/subjects');
  await expect(page.getByText('Farmacología').first()).toBeVisible();
  assertClean();
});

test('UNIVERSITY with a program the catalog does not have: written freely, with no key', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByLabel('Carrera o programa').fill('Medicina del Deporte Extremo');
  await expect(page.getByRole('group', { name: 'Coincidencias' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mi carrera no aparece' }).click();
  await expect(page.getByLabel('Escribe tu carrera o programa')).toHaveValue(
    'Medicina del Deporte Extremo',
  );
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  expect(await profile(page)).toMatchObject({
    programName: 'Medicina del Deporte Extremo',
    programKey: null,
  });
  assertClean();
});

test('a semester beyond ten and a described level are both possible ("Otro")', async ({ page }) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByRole('button', { name: 'Ahora no' }).click(); // program
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  await page.getByRole('button', { name: 'Otro' }).click();
  await page.getByLabel(/^Número/).fill('12');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  expect((await periods(page))[0]).toMatchObject({ studyLevel: 12, studyLevelNote: null });

  // back to the level and describe it instead: the number gives way to the note
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  await expect(page.getByLabel(/^Número/)).toHaveValue('12'); // what the server has
  await page.getByLabel('O descríbelo').fill('Internado');
  await expect(page.getByLabel(/^Número/)).toHaveValue(''); // typing the description emptied the number
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  expect((await periods(page))[0]).toMatchObject({ studyLevel: null, studyLevelNote: 'Internado' });
  assertClean();
});

test('SCHOOL, complete: grade, subjects, home', async ({ page }) => {
  const assertClean = watch(page);
  await START(page, 'Colegio');
  await fillPeriod(page);
  await expect(h1(page, '¿En qué grado estás?')).toBeVisible();
  await page.getByRole('button', { name: 'Grado 10' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias ves?')).toBeVisible();
  await addSubjects(page, ['Matemáticas', 'Biología']);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await finishHome(page);
  expect(await profile(page)).toMatchObject({
    primaryUse: 'SCHOOL_STUDENT',
    onboardingStatus: 'COMPLETED',
  });
  expect((await periods(page))[0]).toMatchObject({ studyLevel: 10 });
  expect((await subjects(page)).map((s) => s.educationContext)).toEqual(['SCHOOL', 'SCHOOL']);
  assertClean();
});

test('TEACHER, complete: no program, no level, straight to the subjects they teach', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Soy docente');
  await fillPeriod(page);
  await expect(h1(page, '¿Qué materias o cursos impartes?')).toBeVisible();
  await addSubjects(page, ['Álgebra Lineal']);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await finishHome(page);
  expect(await profile(page)).toMatchObject({
    primaryUse: 'TEACHER',
    onboardingStatus: 'COMPLETED',
  });
  expect((await periods(page))[0]).toMatchObject({ studyLevel: null, studyLevelNote: null });
  expect((await subjects(page)).map((s) => s.educationContext)).toEqual(['OTHER_ACADEMIC']);
  assertClean();
});

test('OTHER STUDY, complete: free text program, no level question, subjects skipped', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Otro tipo de estudio');
  await fillPeriod(page);
  await expect(h1(page, '¿Qué estás estudiando?')).toBeVisible();
  await page.getByLabel('Curso o programa').fill('Curso de inglés B2');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias o módulos tienes?')).toBeVisible(); // no level step in between
  await expect(page.getByRole('button', { name: /Ahora no|Hacerlo después|Omitir/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Siguiente' }).click(); // no names: Siguiente just moves on
  await finishHome(page);
  expect(await profile(page)).toMatchObject({
    primaryUse: 'OTHER_STUDENT',
    programName: 'Curso de inglés B2',
    programKey: null,
    onboardingStatus: 'COMPLETED',
  });
  expect(await subjects(page)).toEqual([]); // skipped: nothing was created
  assertClean();
});

test('PERSONAL is the shortest path: the period and out (no program, level or subjects)', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Organización personal');
  await fillPeriod(page);
  await expect(h1(page, FINAL)).toBeVisible();
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await profile(page)).toMatchObject({
    primaryUse: 'PERSONAL',
    onboardingStatus: 'COMPLETED',
  });
  expect(await subjects(page)).toEqual([]);
  assertClean();
});

test('every optional step of the university can be skipped, and a finished wizard is never chased', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByRole('button', { name: 'Ahora no' }).click(); // program
  await page.getByRole('button', { name: 'Ahora no' }).click(); // level
  await page.getByRole('button', { name: 'Siguiente' }).click(); // subjects: nothing typed, so it only moves on
  await finishHome(page);
  expect(await profile(page)).toMatchObject({
    primaryUse: 'UNIVERSITY_STUDENT',
    programName: null,
    onboardingStatus: 'COMPLETED',
  });
  expect((await periods(page))[0]).toMatchObject({ studyLevel: null, studyLevelNote: null });
  expect(await subjects(page)).toEqual([]);
  // COMPLETED means "I finished", not "everything is filled": opening it again does not ask for what was left empty
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/dashboard$/);
  assertClean();
});

test('closing the page at the program continues at the program; at the subjects, with the names typed', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();
  await page.reload();
  await expect(h1(page, '¿Qué estudias?')).toBeVisible(); // derived from the server, not a counter

  await page.getByRole('button', { name: 'Ahora no' }).click();
  await page.getByRole('button', { name: 'Semestre 3' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  await addSubjects(page, ['Anatomía', 'Embriología']);
  await page.reload();
  // the skipped program is remembered (not asked again), the level is on the server, and the typed names come back
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar Anatomía' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar Embriología' })).toBeVisible();
  expect(await subjects(page)).toEqual([]); // nothing was created by typing

  await page.getByRole('button', { name: 'Quitar Anatomía' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Quitar Anatomía' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quitar Embriología' })).toBeVisible();
  assertClean();
});

test('a repeated name is refused where it is typed, and "Atrás" keeps every saved answer', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByLabel('Carrera o programa').fill('derecho');
  await page.getByRole('button', { name: 'Derecho', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Semestre 2' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await addSubjects(page, ['Filosofía']);
  await page.locator('#subject-name').fill(' FILOSOFIA ');
  await page.locator('#subject-name').press('Enter');
  await expect(page.getByText('Ya la agregaste.')).toBeVisible();
  await expect(page.locator('li', { hasText: 'Filosofía' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Semestre 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Siguiente' }).click(); // unchanged: it only moves on, and the typed name is still there
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar Filosofía' })).toBeVisible();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();
  await expect(page.getByText('Ahora tienes:')).toContainText('Derecho');
  assertClean();
});

test('an existing student completes the profile: nothing is recreated, the old subjects stay as they are', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  // an existing account: a current period and an older one, subjects with no context, a profile never touched
  const post = async (path: string, data: object) => {
    const res = await page.request.post(path, { data });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  };
  const current = (
    await post('/api/periods', { name: 'Actual', startDate: '2026-08-03', endDate: '2026-11-28' })
  ).period;
  const other = (
    await post('/api/periods', { name: 'Otro', startDate: '2026-02-01', endDate: '2026-06-01' })
  ).period;
  for (const name of ['Anatomía', 'Redes'])
    await post('/api/subjects', { periodId: current.id, name });
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'NOT_STARTED' });

  await page.goto('/dashboard'); // not forced anywhere; it only offers
  await expect(page).toHaveURL(/\/dashboard$/);
  const notice = page.getByRole('region', { name: 'Tu perfil' });
  await expect(notice).toContainText('Completa tu perfil');
  await notice.getByRole('link', { name: 'Completar' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await expect(h1(page, QUESTION)).toBeVisible();
  await use(page, 'Universidad').click();
  await expect(page.getByLabel('Nombre del periodo')).toHaveCount(0); // it has a period: not asked again
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await page.getByRole('button', { name: 'Semestre 5' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Materias que ya tienes' })).toContainText(
    'Anatomía',
  );
  await expect(page.getByRole('list', { name: 'Materias que ya tienes' })).toContainText('Redes');
  await page.locator('#subject-name').fill('anatomia'); // one it already has
  await page.locator('#subject-name').press('Enter');
  await expect(page.getByText('Ya tienes esa materia en este periodo.')).toBeVisible();
  await addSubjects(page, ['Neuroanatomía']);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await finishHome(page);

  const all = await subjects(page);
  expect(all.map((s) => s.name).sort()).toEqual(['Anatomía', 'Neuroanatomía', 'Redes']); // no duplicates
  // the old ones were NOT converted; only the new one takes the default of what the student said
  expect(Object.fromEntries(all.map((s) => [s.name, s.educationContext]))).toEqual({
    Anatomía: null,
    Redes: null,
    Neuroanatomía: 'UNIVERSITY',
  });
  const byId = Object.fromEntries((await periods(page)).map((p) => [p.id, p]));
  expect(byId[current.id]).toMatchObject({ studyLevel: 5 }); // the CURRENT period, not the other one
  expect(byId[other.id]).toMatchObject({ studyLevel: null });
  expect(await profile(page)).toMatchObject({
    primaryUse: 'UNIVERSITY_STUDENT',
    onboardingStatus: 'COMPLETED',
  });
  await expect(page.getByRole('region', { name: 'Tu perfil' })).toHaveCount(0); // the notice is gone
  assertClean();
});

test('"Importar mi horario" completes the wizard and opens the import, which runs nothing by itself', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await addSubjects(page, ['Redes de Computadores']);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, FINAL)).toBeVisible();
  await page.getByRole('button', { name: 'Importar mi horario' }).click();
  await expect(page).toHaveURL(/\/calendar\/import$/);
  expect(await profile(page)).toMatchObject({ onboardingStatus: 'COMPLETED' });
  const schedule = await (
    await page.request.get('/api/schedule?from=2026-08-03&to=2026-08-09')
  ).json();
  expect(schedule.occurrences).toEqual([]); // nothing was imported
  expect((await subjects(page)).map((s) => s.name)).toEqual(['Redes de Computadores']);
  expect(await draftKeys(page)).toEqual([]);
  assertClean();
});

test('the notice on the Home: never started and in progress say so quietly; skipped never insists', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.request.post('/api/periods', {
    data: { name: 'Actual', startDate: '2026-08-03', endDate: '2026-11-28' },
  });
  await page.goto('/dashboard');
  const notice = page.getByRole('region', { name: 'Tu perfil' });
  await expect(notice).toContainText('Completa tu perfil');
  expect(await notice.getByRole('alert').count()).toBe(0);

  // in progress (an answer, not finished)
  await page.request.patch('/api/profile', {
    data: { primaryUse: 'SCHOOL_STUDENT', onboardingStatus: 'IN_PROGRESS' },
  });
  await page.reload();
  await expect(notice).toContainText('Continúa configurando tu perfil');

  // skipped: no insistence
  await page.request.patch('/api/profile', { data: { onboardingStatus: 'SKIPPED' } });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(notice).toHaveCount(0);
  await page.goto('/calendar');
  await page.goto('/dashboard');
  await expect(notice).toHaveCount(0);
  assertClean();
});

test('skipping the profile still asks the period, then ends without changing the status (SKIPPED stays)', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await page.getByRole('button', { name: 'Omitir por ahora' }).click();
  await expect(h1(page, 'Tu periodo actual')).toBeVisible();
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'SKIPPED' });
  await page.goto('/dashboard'); // not allowed through without a period, and it is not asked again
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(h1(page, 'Tu periodo actual')).toBeVisible();
  await fillPeriod(page);
  await finishHome(page);
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'SKIPPED' });
  assertClean();
});

test('closing the page after the first answer and coming back continues at the period', async ({
  page,
  context,
}) => {
  const assertClean = watch(page);
  await START(page, 'Colegio');
  await expect(h1(page, 'Tu periodo escolar')).toBeVisible();
  await page.reload();
  await expect(h1(page, 'Tu periodo escolar')).toBeVisible();
  const again = await context.newPage();
  await again.goto('/dashboard');
  await expect(again).toHaveURL(/\/onboarding$/);
  await expect(h1(again, 'Tu periodo escolar')).toBeVisible();
  await again.close();
  assertClean();
});

test.describe('when saving fails', () => {
  test.use({ serviceWorkers: 'block' });

  test('the choice stays marked, the error says what to do, and tapping again goes on', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await register(page, uniqueEmail());
    await expect(h1(page, QUESTION)).toBeVisible();

    await page.route('**/api/profile', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            json: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
          })
        : route.continue(),
    );
    const option = use(page, 'Universidad');
    await option.click();
    await expect(page.getByRole('alert')).toContainText(
      'Toca una opción para intentarlo de nuevo.',
    );
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(h1(page, QUESTION)).toBeVisible();
    expect((await profile(page)).primaryUse).toBeNull();

    await page.unroute('**/api/profile');
    await option.click();
    await expect(h1(page, 'Tu semestre actual')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('a failed save of the subjects keeps the names and never moves on; retrying creates them once', async ({
    page,
  }) => {
    await register(page, uniqueEmail());
    await expect(h1(page, QUESTION)).toBeVisible();
    await use(page, 'Soy docente').click();
    await fillPeriod(page);
    await expect(h1(page, '¿Qué materias o cursos impartes?')).toBeVisible();
    await addSubjects(page, ['Cálculo', 'Física']);

    await page.route('**/api/subjects/batch', (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      }),
    );
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('alert')).toContainText('Tus materias siguen aquí');
    await expect(page.getByRole('button', { name: 'Quitar Cálculo' })).toBeVisible();
    await expect(h1(page, '¿Qué materias o cursos impartes?')).toBeVisible(); // did not move on
    expect(await subjects(page)).toEqual([]);

    await page.unroute('**/api/subjects/batch');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(h1(page, FINAL)).toBeVisible();
    expect((await subjects(page)).map((s) => s.name).sort()).toEqual(['Cálculo', 'Física']);
  });

  test('while Siguiente saves it says so and a second tap sends nothing', async ({ page }) => {
    await START(page, 'Soy docente');
    await fillPeriod(page);
    await addSubjects(page, ['Cálculo']);
    let posts = 0;
    await page.route('**/api/subjects/batch', async (route) => {
      posts += 1;
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    const next = page.getByRole('button', { name: 'Siguiente' });
    await next.click();
    await expect(page.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await page
      .getByRole('button', { name: 'Guardando…' })
      .click({ force: true, timeout: 500 })
      .catch(() => {});
    await expect(h1(page, FINAL)).toBeVisible();
    expect(posts).toBe(1);
  });

  test('without a connection the answer says so, what was typed stays, and it goes on when it is back', async ({
    page,
    context,
  }) => {
    await register(page, uniqueEmail());
    await expect(h1(page, QUESTION)).toBeVisible();
    await context.setOffline(true);
    await use(page, 'Colegio').click();
    await expect(page.getByRole('alert')).toContainText(/conexi/i);
    await context.setOffline(false);
    await use(page, 'Colegio').click();
    await expect(h1(page, 'Tu periodo escolar')).toBeVisible();

    await page.getByLabel('Inicio', { exact: true }).fill('2026-08-03');
    await page.getByLabel('Fin', { exact: true }).fill('2026-11-28');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('alert')).toContainText(/conexi/i);
    await expect(page.getByLabel('Inicio', { exact: true })).toHaveValue('2026-08-03');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(h1(page, '¿En qué grado estás?')).toBeVisible();
  });
});

test('a student who already has a period is NOT sent to the onboarding when logging in', async ({
  page,
}) => {
  const assertClean = watch(page);
  const email = uniqueEmail();
  await register(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  const res = await page.request.post('/api/periods', {
    data: { name: 'Periodo existente', startDate: '2026-08-03', endDate: '2026-11-28' },
  });
  expect(res.status()).toBe(201);
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'NOT_STARTED' });
  await page.request.post('/api/auth/logout');

  await page.goto('/login');
  await login(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/calendar$/);
  assertClean();
});

test('tapping a program or a level only MARKS it: nothing is saved until Siguiente, and a slip can be corrected', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByLabel('Carrera o programa').fill('derecho');
  await page.getByRole('button', { name: 'Derecho', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Derecho', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(h1(page, '¿Qué estudias?')).toBeVisible(); // it did not move on by itself
  expect((await profile(page)).programName).toBeNull(); // and nothing was saved
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  expect(await profile(page)).toMatchObject({ programKey: 'derecho', programName: 'Derecho' });

  await page.getByRole('button', { name: 'Semestre 2' }).click();
  await page.getByRole('button', { name: 'Semestre 3' }).click(); // the slip, corrected
  await expect(page.getByRole('button', { name: 'Semestre 2' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Semestre 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  expect((await periods(page))[0]).toMatchObject({ studyLevel: null });
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  expect((await periods(page))[0]).toMatchObject({ studyLevel: 3 });
  assertClean();
});

test('program: Siguiente with nothing says what to do, asks to tap a match, and "Ahora no" moves on without saving', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText('toca «Ahora no»')).toBeVisible();
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();

  await page.getByLabel('Carrera o programa').fill('psico'); // words that point at the catalog, none tapped
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText('Toca tu carrera en la lista')).toBeVisible();
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();
  expect((await profile(page)).programName).toBeNull();

  await page.getByRole('button', { name: 'Ahora no' }).click(); // what was typed is not saved
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  expect(await profile(page)).toMatchObject({ programName: null, programKey: null });
  assertClean();
});

test('"Otro": the number and the description exclude each other as they are typed', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Universidad');
  await fillPeriod(page);
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await page.getByRole('button', { name: 'Otro' }).click();
  await expect(page.getByText('Usa una sola opción.')).toBeVisible();
  await page.getByLabel('O descríbelo').fill('Internado');
  await page.getByLabel(/^Número/).fill('12');
  await expect(page.getByLabel('O descríbelo')).toHaveValue(''); // typing the number emptied the description
  await page.getByLabel('O descríbelo').fill('Año rural');
  await expect(page.getByLabel(/^Número/)).toHaveValue('');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  expect((await periods(page))[0]).toMatchObject({ studyLevel: null, studyLevelNote: 'Año rural' });
  assertClean();
});

test('subjects: Siguiente with nothing typed moves on without any request; a name typed but not entered goes with it', async ({
  page,
}) => {
  const assertClean = watch(page);
  const batches: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/subjects/batch')) batches.push(r.method());
  });
  await START(page, 'Soy docente');
  await fillPeriod(page);
  await expect(h1(page, '¿Qué materias o cursos impartes?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ahora no|Hacerlo después|Omitir/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, FINAL)).toBeVisible();
  expect(batches).toEqual([]); // nothing to create: no request
  expect(await subjects(page)).toEqual([]);

  await page.getByRole('button', { name: 'Atrás' }).click();
  await page.locator('#subject-name').fill('Lógica'); // typed, Enter never pressed
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, FINAL)).toBeVisible();
  expect(batches).toEqual(['POST']);
  expect((await subjects(page)).map((x) => x.name)).toEqual(['Lógica']);
  assertClean();
});

test('keyboard: the options are reachable with Tab and chosen with Space, with a visible focus', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(h1(page, QUESTION)).toBeVisible();
  const first = use(page, 'Universidad');
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(use(page, 'Colegio')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(h1(page, 'Tu periodo escolar')).toBeVisible();
  assertClean();
});

test('Enter adds a subject without submitting the step, and the chips are reachable and removable by keyboard', async ({
  page,
}) => {
  const assertClean = watch(page);
  await START(page, 'Soy docente');
  await fillPeriod(page);
  await expect(h1(page, '¿Qué materias o cursos impartes?')).toBeVisible();
  await page.locator('#subject-name').fill('Química');
  await page.keyboard.press('Enter');
  await page.locator('#subject-name').fill('Física');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('list', { name: 'Materias por agregar' }).getByRole('listitem'),
  ).toHaveCount(2);
  expect(await subjects(page)).toEqual([]);
  await page.getByRole('button', { name: 'Quitar Química' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Quitar Química' })).toHaveCount(0);
  await expect(page.getByText('Al pulsar «Siguiente» se agregará 1 materia.')).toBeVisible();
  assertClean();
});

test('every step fits every width: 44 px targets, one h1, no overflow and no axe violations', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const assertClean = watch(page);
  const axe = async (label: string) => {
    await page.waitForTimeout(700); // the entrances finish: axe must read the final colors
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      label,
    ).toEqual([]);
  };
  const smallTargets = (p: Page) =>
    p.locator('button, input, a, select').evaluateAll((els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height < 43.5;
        })
        .map((el) => `${el.tagName} ${el.textContent?.slice(0, 24) ?? ''}`),
    );
  const audit = async (label: string) => {
    for (const width of [320, 360, 390, 430, 768, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await smallTargets(page), `${label}: targets at ${width}`).toEqual([]);
      if (width === 390 || width === 1366) await axe(`${label} at ${width}`);
    }
  };

  await register(page, uniqueEmail());
  await expect(h1(page, QUESTION)).toBeVisible();
  await audit('question');
  await use(page, 'Universidad').click();
  await expect(h1(page, 'Tu semestre actual')).toBeVisible();
  await audit('period');
  await fillPeriod(page);
  await expect(h1(page, '¿Qué estudias?')).toBeVisible();
  await page.getByLabel('Carrera o programa').fill('ing');
  await expect(page.getByRole('group', { name: 'Coincidencias' })).toBeVisible();
  await audit('program with results');
  await page.getByRole('button', { name: 'Mi carrera no aparece' }).click();
  await audit('custom program');
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
  await audit('level');
  await page.getByRole('button', { name: 'Otro' }).click();
  await audit('level other');
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await expect(h1(page, '¿Qué materias estás cursando?')).toBeVisible();
  await addSubjects(page, [
    'Farmacología',
    'Semiología',
    'Bioestadística',
    'Una materia con un nombre bastante largo para comprobar el ajuste de la línea',
  ]);
  await audit('subjects with chips');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(h1(page, FINAL)).toBeVisible();
  await audit('final');
  assertClean();
});

test('completeOnboarding (the helper of the other specs) still leaves a user with a period in the subjects', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await expect(page).toHaveURL(/\/subjects$/);
  expect((await periods(page)).length).toBe(1);
  assertClean();
});
