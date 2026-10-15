import { expect, test, type Page, type Request } from '@playwright/test';
import { bogotaToday, register, uniqueEmail, watch } from './helpers';

/**
 * Completing the onboarding into a study (P0.5-5, D35). A student who says they study ends with a PRIMARY study and the period
 * they made is ADOPTED in place (never copied); a teacher, a personal use and an older account get none. The study is created
 * ONLY by the completion, never while the student answers, and an older account is never migrated silently.
 */
test.use({ serviceWorkers: 'block' }); // some tests intercept the completion request

const FINAL = 'Listo para empezar';
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const use = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(title) });
const apiGet = async (page: Page, path: string) => {
  const res = await page.request.get(path);
  expect(res.status(), path).toBe(200);
  return res.json();
};
const tracks = async (page: Page) => (await apiGet(page, '/api/study-tracks')).studyTracks;
const next = (page: Page) => page.getByRole('button', { name: 'Siguiente' }).click();

const start = async (page: Page, title: string) => {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await use(page, title).click();
};
const period = async (page: Page) => {
  await page.getByLabel('Inicio', { exact: true }).fill('2026-08-03');
  await page.getByLabel('Fin', { exact: true }).fill('2026-11-28');
  await next(page);
};
const addSubjects = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.locator('#subject-name').fill(name);
    await page.locator('#subject-name').press('Enter');
    await expect(page.getByRole('button', { name: `Quitar ${name}` })).toBeVisible();
  }
  await next(page);
};
/** The whole wizard of a university student up to the last screen (program: a catalog entry, or skipped). */
async function universityUntilFinal(page: Page, program: 'Medicina' | null) {
  await start(page, 'Universidad');
  await period(page);
  if (program) {
    await page.getByLabel('Carrera o programa').fill(program.slice(0, 4));
    await page
      .getByRole('group', { name: 'Coincidencias' })
      .getByRole('button', { name: program, exact: true })
      .click();
    await next(page);
  } else {
    await page.getByRole('button', { name: 'Ahora no' }).click();
  }
  await page.getByRole('button', { name: 'Semestre 4' }).click();
  await next(page);
  await addSubjects(page, ['Farmacología', 'Semiología']);
  await expect(h1(page, FINAL)).toBeVisible();
}

test('UNIVERSITY: nothing exists until the last screen; completing creates the primary study and adopts the SAME period', async ({
  page,
}) => {
  const assertClean = watch(page);
  await universityUntilFinal(page, 'Medicina');
  // every answer was saved, and still NO study exists: the student could have gone back
  expect(await tracks(page)).toEqual([]);
  const before = (await apiGet(page, '/api/periods')).periods;
  expect(before).toHaveLength(1);
  expect(before[0].studyTrackId).toBeNull();
  const subjectsBefore = (await apiGet(page, '/api/subjects')).subjects.map(
    (s: { id: string }) => s.id,
  );
  // the last screen says what will happen, in the student's words
  await expect(
    page.getByText('Listo. Organizaremos este periodo dentro de Medicina.'),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/StudyTrack|migrar|adoptar|scope/i);

  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const [study] = await tracks(page);
  expect(study).toMatchObject({
    name: 'Medicina',
    type: 'UNIVERSITY',
    programKey: 'medicina',
    isPrimary: true,
    status: 'ACTIVE',
  });
  const after = (await apiGet(page, '/api/periods')).periods;
  expect(after).toHaveLength(1); // never copied
  expect(after[0]).toMatchObject({
    id: before[0].id,
    startDate: before[0].startDate,
    endDate: before[0].endDate,
    studyLevel: 4,
    isCurrent: true,
    studyTrackId: study.id,
  });
  expect((await apiGet(page, '/api/subjects')).subjects.map((s: { id: string }) => s.id)).toEqual(
    subjectsBefore,
  );
  expect((await apiGet(page, '/api/profile')).profile.onboardingStatus).toBe('COMPLETED');

  // Mis estudios shows it, with the same period and subjects
  await page.goto('/settings/studies');
  const card = page.locator('li', {
    has: page.getByRole('heading', { level: 3, name: 'Medicina' }),
  });
  await expect(card).toContainText('Principal');
  await expect(card).toContainText('Periodo actual:');
  await expect(card).toContainText('4.º semestre');
  await expect(card).toContainText('2 materias');
  await expect(page.getByRole('region', { name: 'Tu planificación actual' })).toHaveCount(0);
  assertClean();
});

test('UNIVERSITY without a program: the study is "Universidad"', async ({ page }) => {
  const assertClean = watch(page);
  await universityUntilFinal(page, null);
  await expect(
    page.getByText('Listo. Organizaremos este periodo dentro de Universidad.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await tracks(page)).toMatchObject([
    { name: 'Universidad', type: 'UNIVERSITY', programKey: null, isPrimary: true },
  ]);
  assertClean();
});

test('SCHOOL: the study is "Colegio"', async ({ page }) => {
  const assertClean = watch(page);
  await start(page, 'Colegio');
  await period(page);
  await page.getByRole('button', { name: 'Grado 10' }).click();
  await next(page);
  await next(page); // subjects: none
  await expect(h1(page, FINAL)).toBeVisible();
  await expect(
    page.getByText('Listo. Organizaremos este periodo dentro de Colegio.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await tracks(page)).toMatchObject([
    { name: 'Colegio', type: 'SCHOOL', programKey: null, isPrimary: true },
  ]);
  expect((await apiGet(page, '/api/periods')).periods[0]).toMatchObject({ studyLevel: 10 });
  assertClean();
});

test('OTHER STUDY: the study is the program or course they wrote', async ({ page }) => {
  const assertClean = watch(page);
  await start(page, 'Otro tipo de estudio');
  await period(page);
  await page.getByLabel('Curso o programa').fill('Inglés B2');
  await next(page);
  await next(page); // subjects: none
  await expect(h1(page, FINAL)).toBeVisible();
  await expect(
    page.getByText('Listo. Organizaremos este periodo dentro de Inglés B2.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await tracks(page)).toMatchObject([
    { name: 'Inglés B2', type: 'OTHER_ACADEMIC', programKey: null, isPrimary: true },
  ]);
  assertClean();
});

for (const [title, value] of [
  ['Organización personal', 'PERSONAL'],
  ['Soy docente', 'TEACHER'],
] as const) {
  test(`${value}: completing creates NO study and the last screen promises none`, async ({
    page,
  }) => {
    const assertClean = watch(page);
    await start(page, title);
    await period(page);
    if (value === 'TEACHER') await next(page); // the subjects they teach: none
    await expect(h1(page, FINAL)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Organizaremos');
    await page.getByRole('button', { name: 'Ir al Inicio' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await tracks(page)).toEqual([]);
    expect((await apiGet(page, '/api/profile')).profile).toMatchObject({
      primaryUse: value,
      onboardingStatus: 'COMPLETED',
    });
    expect((await apiGet(page, '/api/periods')).periods[0].studyTrackId).toBeNull();
    assertClean();
  });
}

test('"Importar mi horario" and "Ir al Inicio" wait for the completion: nobody leaves before it is saved', async ({
  page,
}) => {
  const assertClean = watch(page);
  await universityUntilFinal(page, 'Medicina');
  // hold the completion back: the student must still be on the last screen while it is pending
  await page.route('**/api/onboarding/complete', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const calls: string[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/api/onboarding/complete')) calls.push(r.method());
  });
  await page.getByRole('button', { name: 'Importar mi horario' }).click();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/onboarding$/); // still here: the completion has not answered
  await expect(h1(page, FINAL)).toBeVisible();
  // a second tap while it saves does not call again
  await page
    .getByRole('button', { name: 'Ir al Inicio' })
    .click({ force: true, timeout: 1000 })
    .catch(() => {});
  await expect(page).toHaveURL(/\/calendar\/import$/, { timeout: 15_000 }); // and only then it leaves, to the import
  expect(calls).toEqual(['POST']); // exactly one completion
  expect(await tracks(page)).toHaveLength(1);
  assertClean();
});

test('a failed completion keeps the student on the last screen with the error; the retry works and creates ONE study', async ({
  page,
}) => {
  const assertClean = watch(page, ['409 /api/onboarding/complete']);
  await universityUntilFinal(page, 'Medicina');
  await page.route('**/api/onboarding/complete', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'CONFLICT', message: 'No se pudo guardar.' } }),
    }),
  );
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar.');
  await expect(page).toHaveURL(/\/onboarding$/); // no navigation
  await expect(h1(page, FINAL)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ir al Inicio' })).toBeEnabled();
  expect(await tracks(page)).toEqual([]); // nothing was left half done
  // the answers (the subjects, the program) are still there; the retry goes through
  await page.unroute('**/api/onboarding/complete');
  await page.getByRole('button', { name: 'Ir al Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await tracks(page)).toHaveLength(1);
  assertClean();
});

test('an OLDER account (finished, a program, a general period, no study) is NEVER migrated silently: opening the app writes nothing', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  for (const data of [
    { primaryUse: 'UNIVERSITY_STUDENT', programKey: 'medicina', onboardingStatus: 'IN_PROGRESS' },
    { onboardingStatus: 'COMPLETED' },
  ]) {
    expect((await page.request.patch('/api/profile', { data })).status()).toBe(200);
  }
  const created = await page.request.post('/api/periods', {
    data: { name: '2026-2', startDate: bogotaToday(-30), endDate: bogotaToday(90) },
  });
  expect(created.status()).toBe(201);
  const profileBefore = (await apiGet(page, '/api/profile')).profile;

  const writes: string[] = [];
  const track = (r: Request) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`);
  };
  page.on('request', track);
  for (const path of ['/dashboard', '/settings/studies', '/subjects', '/activities']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  // reopening the onboarding and pressing the last button leaves it as it was
  await page.goto('/onboarding');
  page.off('request', track);
  expect(writes, 'opening the app must not write anything').toEqual([]);
  expect(await tracks(page)).toEqual([]);
  expect((await apiGet(page, '/api/profile')).profile).toEqual(profileBefore);
  expect((await apiGet(page, '/api/periods')).periods[0].studyTrackId).toBeNull();

  // only the student's own action creates it: Mis estudios -> Convertir en estudio (a proposal from the profile)
  await page.goto('/settings/studies');
  await page.getByRole('button', { name: 'Convertir en estudio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convertir en estudio' });
  await expect(dialog.getByLabel('Nombre del estudio')).toHaveValue('Medicina');
  await dialog.getByRole('button', { name: 'Convertir en estudio' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ya es un estudio' })).toBeVisible();
  expect(await tracks(page)).toHaveLength(1);
  assertClean();
});

for (const archived of [false, true]) {
  test(`a study set up in Mis estudios DURING the onboarding${archived ? ' (and archived)' : ''}: no program question, no 409, it is not touched and no second study appears`, async ({
    page,
  }) => {
    const assertClean = watch(page);
    await start(page, 'Universidad');
    await period(page);
    // the student is now asked the program... but first sets up a study on their own (here: through the API, deterministic)
    await expect(page.getByLabel('Carrera o programa')).toBeVisible();
    const created = await page.request.post('/api/study-tracks', {
      data: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).studyTrack.id;
    if (archived) {
      expect(
        (await page.request.post(`/api/study-tracks/${id}/archive`, { data: {} })).status(),
      ).toBe(200);
    }
    const profileWrites: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().endsWith('/api/profile')) {
        profileWrites.push(r.postData() ?? '');
      }
    });
    await page.reload();

    // the program is not asked: the study is the authority. The wizard goes on with what is still pending
    await expect(h1(page, '¿En qué semestre estás?')).toBeVisible();
    await expect(page.getByLabel('Carrera o programa')).toHaveCount(0);
    await expect(page.getByText('se administra desde Mis estudios')).toHaveCount(0);
    await page.getByRole('button', { name: 'Semestre 4' }).click();
    await next(page);
    await addSubjects(page, ['Farmacología']);
    await expect(h1(page, FINAL)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Organizaremos'); // completing will not create another study
    await page.getByRole('button', { name: 'Ir al Inicio' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // nothing wrote the profile's program, nothing was refused, and the study the student set up is exactly as they left it
    expect(profileWrites.filter((b) => /program(Name|Key)/.test(b))).toEqual([]);
    const all = await tracks(page);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id,
      name: 'Diplomado',
      type: 'OTHER_ACADEMIC',
      isPrimary: !archived,
      status: archived ? 'ARCHIVED' : 'ACTIVE',
    });
    expect((await apiGet(page, '/api/profile')).profile).toMatchObject({
      primaryUse: 'UNIVERSITY_STUDENT',
      programName: null,
      programKey: null,
      onboardingStatus: 'COMPLETED',
    });
    // the period they made is still general (their own setup wins: completing did not link it)
    expect((await apiGet(page, '/api/periods')).periods[0].studyTrackId).toBeNull();
    assertClean();
  });
}
