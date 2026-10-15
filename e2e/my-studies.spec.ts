import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
  bogotaToday,
  entrancesDone,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * "Mis estudios": the first screen that manages several studies. The accounts are prepared through the API (there is no other way
 * to have an OLDER account: one with a program in its profile and a period that belongs to no study).
 */
test.setTimeout(90_000);

const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };

const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};
const get = async (page: Page, path: string) => {
  const res = await page.request.get(path);
  expect(res.status(), path).toBe(200);
  return res.json();
};

/** An account from BEFORE the studies existed: a university profile, one general period (level 4), a subject, an activity and a class. */
async function legacyAccount(page: Page) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  for (const data of [
    { primaryUse: 'UNIVERSITY_STUDENT', programKey: 'medicina', onboardingStatus: 'IN_PROGRESS' },
    { onboardingStatus: 'COMPLETED' },
  ]) {
    const patch = await page.request.patch('/api/profile', { data });
    expect(patch.status(), await patch.text()).toBe(200);
  }
  const period = (await post(page, '/api/periods', { name: '2026-2', ...dates, studyLevel: 4 }))
    .period;
  const subject = (await post(page, '/api/subjects', { periodId: period.id, name: 'Farmacología' }))
    .subject;
  const activity = (
    await post(page, '/api/activities', {
      subjectId: subject.id,
      title: 'Parcial de Farmacología',
      dueDate: bogotaToday(3),
      type: 'EXAM',
    })
  ).activity;
  await post(page, '/api/schedule', {
    type: 'CLASS',
    periodId: period.id,
    subjectId: subject.id,
    title: 'Clase de Farmacología',
    date: bogotaToday(0),
    startTime: '06:00',
    endTime: '07:00',
  });
  return { period, subject, activity };
}

const studyCard = (page: Page, name: string) =>
  page.locator('li', { has: page.getByRole('heading', { level: 3, name }) });

/** Opens "Más acciones" of a study and chooses one of its items. */
async function chooseAction(page: Page, study: string, item: string) {
  await page.getByRole('button', { name: `Más acciones: ${study}`, exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
}

test('an OLDER account: opening Mis estudios writes nothing; the plan is offered, converted on request, and nothing moves', async ({
  page,
}) => {
  const assertClean = watch(page);
  const { period, subject, activity } = await legacyAccount(page);
  const writes: string[] = [];
  const track = (r: Request) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`);
  };
  page.on('request', track);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Mis estudios', exact: true }).click(); // the way in is always in the top bar
  await expect(page).toHaveURL(/\/settings\/studies$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mis estudios' })).toBeVisible();
  const plan = page.getByRole('region', { name: 'Tu planificación actual' });
  await expect(plan).toContainText('2026-2');
  await expect(plan).toContainText('1 materia');
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0); // no study exists yet
  await entrancesDone(page);
  page.off('request', track);
  expect(writes, 'opening the screen must not write anything').toEqual([]);
  expect((await get(page, '/api/study-tracks')).studyTracks).toEqual([]); // the profile did NOT create a study

  // the proposal comes from the profile, and it is only a proposal
  await plan.getByRole('button', { name: 'Convertir en estudio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convertir en estudio' });
  await expect(dialog.getByLabel('Nombre del estudio')).toHaveValue('Medicina');
  await expect(dialog.getByLabel('Tipo de estudio')).toHaveValue('UNIVERSITY');
  await dialog.getByLabel('Nombre del estudio').fill('Medicina General');
  await dialog.getByRole('button', { name: 'Convertir en estudio' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ya es un estudio' })).toBeVisible();

  const card = studyCard(page, 'Medicina General');
  await expect(card).toContainText('Principal');
  await expect(card).toContainText('Universidad');
  await expect(card).toContainText('Periodo actual: 2026-2');
  await expect(card).toContainText('4.º semestre');
  await expect(card).toContainText('1 materia');
  await expect(page.getByRole('region', { name: 'Tu planificación actual' })).toHaveCount(0);

  // the SAME period (id, dates, level) and everything in it, untouched
  const periods = (await get(page, '/api/periods')).periods;
  expect(periods).toHaveLength(1);
  expect(periods[0]).toMatchObject({
    id: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
    studyLevel: 4,
    isCurrent: true,
  });
  expect(periods[0].studyTrackId).not.toBeNull();
  const subjects = (await get(page, `/api/subjects?periodId=${period.id}`)).subjects;
  expect(subjects.map((s: { id: string }) => s.id)).toEqual([subject.id]);
  expect((await get(page, `/api/activities/${activity.id}`)).activity.periodId).toBe(period.id);
  // the profile is not the study's authority yet: it stays exactly as it was
  expect((await get(page, '/api/profile')).profile).toMatchObject({
    programKey: 'medicina',
    primaryUse: 'UNIVERSITY_STUDENT',
  });
  // and the app did not send the user to the onboarding: the HOME period is the same one
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await get(page, '/api/periods/home')).period.id).toBe(period.id);
  assertClean();
});

test('add a second study with the short flow; both are read by the Home; the first stays the main one', async ({
  page,
}) => {
  const assertClean = watch(page);
  await legacyAccount(page);
  await post(page, '/api/study-tracks/adopt-period', {
    periodId: (await get(page, '/api/periods')).periods[0].id,
    name: 'Medicina',
    type: 'UNIVERSITY',
  });
  await page.goto('/settings/studies');
  await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar estudio' });
  await dialog.getByRole('button', { name: /Otro estudio/ }).click();
  await expect(dialog.getByText('Paso 1 de 6')).toBeVisible(); // the same six steps for every kind of study
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByLabel('Nombre del estudio').fill('Diplomado en Ciberseguridad');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByLabel('Nombre del periodo').fill('Cohorte oct–dic');
  await dialog.getByLabel('Inicio', { exact: true }).fill(dates.startDate);
  await dialog.getByLabel('Fin', { exact: true }).fill(dates.endDate);
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  // "Otro estudio" asks the level too, in its own words, and it is optional: Siguiente with nothing is valid
  await expect(
    dialog.getByRole('heading', { level: 3, name: '¿En qué nivel estás?' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByLabel('Escribe una materia').fill('Seguridad de Redes');
  await dialog.getByLabel('Escribe una materia').press('Enter');
  await dialog.getByLabel('Escribe una materia').fill('Criptografía');
  await dialog.getByLabel('Escribe una materia').press('Enter');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await expect(dialog.getByText('Cohorte oct–dic')).toBeVisible(); // the confirmation shows what will be created
  await expect(dialog.getByText('2 materias')).toBeVisible();
  await dialog.getByRole('button', { name: 'Crear estudio' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Agregaste' })).toBeVisible();

  const card = studyCard(page, 'Diplomado en Ciberseguridad');
  await expect(card).toContainText('Otro estudio');
  await expect(card).toContainText('Periodo actual: Cohorte oct–dic');
  await expect(card).toContainText('2 materias');
  await expect(card).not.toContainText('Principal');
  await expect(studyCard(page, 'Medicina')).toContainText('Principal');
  const tracks = (await get(page, '/api/study-tracks')).studyTracks;
  expect(tracks.filter((t: { isPrimary: boolean }) => t.isPrimary)).toHaveLength(1);

  await page.goto('/dashboard');
  await entrancesDone(page);
  await expect(
    page.getByText('En tus estudios actuales: Medicina · Diplomado en Ciberseguridad'),
  ).toBeVisible();
  assertClean();
});

test('making the second study the main one moves HOME, and the Home is still one and global', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const a = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-2', ...dates },
    subjects: ['Farmacología'],
  });
  const b = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
    period: { name: 'Cohorte', ...dates },
  });
  expect((await get(page, '/api/periods/home')).period.id).toBe(a.period.id);
  await page.goto('/settings/studies');
  await chooseAction(page, 'Diplomado', 'Hacer principal');
  const dialog = page.getByRole('dialog', { name: /Hacer principal «Diplomado»/ });
  await dialog.getByRole('button', { name: 'Hacer principal' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'es ahora tu estudio principal' }),
  ).toBeVisible();
  expect((await get(page, '/api/periods/home')).period.id).toBe(b.period.id);
  await expect(studyCard(page, 'Diplomado')).toContainText('Principal');
  await expect(studyCard(page, 'Medicina')).not.toContainText('Principal');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/); // the app did not send anyone to the onboarding
  await entrancesDone(page);
  await expect(page.getByText('En tus estudios actuales: Diplomado · Medicina')).toBeVisible();
  assertClean();
});

test('Ver materias opens the subjects of THAT study, and a new subject goes to the period shown', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const a = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-2', ...dates },
    subjects: ['Farmacología'],
  });
  const b = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
    period: { name: 'Cohorte', ...dates },
    subjects: ['Seguridad de Redes'],
  });
  await page.goto('/settings/studies');
  await page.getByRole('link', { name: 'Ver materias de Diplomado' }).click();
  await expect(page).toHaveURL(new RegExp(`/subjects\\?period=${b.period.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Mis asignaturas' })).toBeVisible();
  await expect(page.getByText(/^Diplomado · Cohorte/)).toBeVisible(); // says WHICH study when there are several
  await expect(page.getByText('Seguridad de Redes').first()).toBeVisible();
  await expect(page.getByText('Farmacología')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar asignatura' }).first().click();
  const form = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await form.getByLabel('Nombre').fill('Ética profesional');
  await form.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('Ética profesional').first()).toBeVisible();
  const created = (await get(page, `/api/subjects?periodId=${b.period.id}`)).subjects.find(
    (s: { name: string }) => s.name === 'Ética profesional',
  );
  expect(created).toMatchObject({ periodId: b.period.id, educationContext: 'OTHER_ACADEMIC' }); // the study's type
  expect(
    (await get(page, `/api/subjects?periodId=${a.period.id}`)).subjects.map(
      (s: { name: string }) => s.name,
    ),
  ).toEqual(['Farmacología']);
  // the plain page is still HOME (Medicina), and a period that is not yours looks like one that does not exist
  await page.goto('/subjects');
  await expect(page.getByText('Farmacología').first()).toBeVisible();
  await page.goto('/subjects?period=00000000-0000-4000-8000-000000000099');
  await expect(page.getByText('No encontramos ese periodo.')).toBeVisible();
  assertClean();
});

test('archive and restore: the main study needs a replacement first; a restored study has no current period until one is chosen', async ({
  page,
}) => {
  const assertClean = watch(page, ['409 /api/study-tracks/*']); // the refused archive of the main study is the point
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const a = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-2', ...dates },
  });
  const b = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
    period: { name: 'Cohorte', ...dates },
    subjects: ['Seguridad de Redes'],
  });
  await page.goto('/settings/studies');

  // the main one cannot leave while it has company: said in plain words, never as a code
  await chooseAction(page, 'Medicina', 'Archivar');
  const blocked = page.getByRole('dialog', { name: /Archivar «Medicina»/ });
  await blocked.getByRole('button', { name: 'Archivar' }).click();
  await expect(blocked.getByRole('alert')).toContainText(
    'Elige primero otro estudio como principal.',
  );
  await expect(blocked).not.toContainText('PRIMARY_TRACK');
  await blocked.getByRole('button', { name: 'Cancelar' }).click();

  // the secondary one can: it leaves the summaries, nothing is deleted
  await chooseAction(page, 'Diplomado', 'Archivar');
  const dialog = page.getByRole('dialog', { name: /Archivar «Diplomado»/ });
  await expect(dialog).toContainText('Dejará de aparecer en tus resúmenes actuales');
  await expect(dialog).toContainText('Tus datos no se borrarán');
  await dialog.getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'quedó archivado' })).toBeVisible();
  const archived = page.getByRole('region', { name: 'Archivados' });
  await expect(archived).toContainText('Diplomado');
  await expect(archived).toContainText('Archivado');
  await expect(studyCard(page, 'Diplomado')).toHaveCount(0);
  await page.goto('/dashboard');
  await entrancesDone(page);
  await expect(page.getByText('En tus estudios actuales')).toHaveCount(0); // one study left: the usual copy
  expect((await get(page, '/api/periods/current')).periods).toHaveLength(1);

  // restore: it comes back WITHOUT a current period (nothing is reactivated by guessing)
  await page.goto('/settings/studies');
  await page.getByRole('button', { name: 'Restaurar Diplomado' }).click();
  await page
    .getByRole('dialog', { name: /Restaurar «Diplomado»/ })
    .getByRole('button', { name: 'Restaurar' })
    .click();
  const card = studyCard(page, 'Diplomado');
  await expect(card).toContainText('Sin periodo actual');
  expect((await get(page, '/api/periods/current')).periods).toHaveLength(1);

  // ...and the student chooses it: mark the old period current
  await card.getByRole('button', { name: 'Elegir o crear periodo' }).click();
  const periods = page.getByRole('dialog', { name: 'Periodos de Diplomado' });
  await periods.getByRole('button', { name: 'Marcar Cohorte como periodo actual' }).click();
  await expect(card).toContainText('Periodo actual: Cohorte');
  await expect(card).toContainText('1 materia');
  expect(
    (await get(page, '/api/periods/current')).periods.map(
      (p: { period: { id: string } }) => p.period.id,
    ),
  ).toEqual([a.period.id, b.period.id]);
  assertClean();
});

test('a new period for a study, and editing a study, both through the same screen', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-1', ...dates },
  });
  await page.goto('/settings/studies');
  await chooseAction(page, 'Medicina', 'Periodos');
  const periods = page.getByRole('dialog', { name: 'Periodos de Medicina' });
  await periods.getByRole('button', { name: 'Nuevo periodo' }).click();
  const form = page.getByRole('dialog', { name: 'Nuevo periodo' });
  await form.getByLabel('Nombre del periodo').fill('2026-2');
  await form.getByLabel('Inicio', { exact: true }).fill(bogotaToday(100));
  await form.getByLabel('Fin', { exact: true }).fill(bogotaToday(200));
  await form.getByLabel(/^Nivel/).fill('5');
  await form.getByRole('button', { name: 'Crear periodo' }).click();
  const card = studyCard(page, 'Medicina');
  await expect(card).toContainText('Periodo actual: 2026-2'); // the new one replaced the current one of THIS study
  await expect(card).toContainText('5.º semestre');

  await chooseAction(page, 'Medicina', 'Editar');
  const edit = page.getByRole('dialog', { name: 'Editar estudio' });
  await edit.getByLabel('Nombre del estudio').fill('Medicina Veterinaria');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(studyCard(page, 'Medicina Veterinaria')).toBeVisible();
  assertClean();
});

test('a school study through the flow (its name is offered) and a technical one: both kinds are shown in plain words', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Técnico en Sistemas', type: 'OTHER_ACADEMIC' },
    period: { name: 'Módulo 1', ...dates },
  });
  await page.goto('/settings/studies');
  await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar estudio' });
  await dialog.getByRole('button', { name: /Colegio/ }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await expect(dialog.getByLabel('Nombre del estudio')).toHaveValue('Colegio'); // offered, editable
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByLabel('Nombre del periodo').fill('Año 2026');
  await dialog.getByLabel('Inicio', { exact: true }).fill(dates.startDate);
  await dialog.getByLabel('Fin', { exact: true }).fill(dates.endDate);
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Grado 9' }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click(); // no subjects: move on
  await dialog.getByRole('button', { name: 'Crear estudio' }).click();
  const school = studyCard(page, 'Colegio');
  await expect(school).toContainText('Grado 9');
  await expect(school).toContainText('Sin materias');
  await expect(school.locator('p', { hasText: /^Colegio$|^Universidad$/ }).first()).toBeVisible();
  await expect(studyCard(page, 'Técnico en Sistemas')).toContainText('Otro estudio');
  assertClean();
});

test('Mis estudios fits every width and is clean for assistive technology, with long names and with a dialog open', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await post(page, '/api/study-tracks/setup', {
    track: {
      name: 'Diplomado de especialización en seguridad informática y redes de computadores',
      type: 'OTHER_ACADEMIC',
    },
    period: { name: 'Cohorte de octubre a diciembre del año dos mil veintiséis', ...dates },
    subjects: ['Seguridad de Redes'],
  });
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-2', ...dates, studyLevel: 4 },
  });
  const axe = async (label: string) => {
    await entrancesDone(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      label,
    ).toEqual([]);
  };
  await page.goto('/settings/studies');
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await axe('list');

  await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar estudio' });
  await expect(dialog.getByRole('heading', { level: 3 })).toBeFocused(); // the step takes the focus
  await expectNoHorizontalOverflow(page);
  await axe('wizard');
  await dialog.getByRole('button', { name: /Universidad/ }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await expectNoHorizontalOverflow(page);
  await axe('wizard, program step');
  await page.keyboard.press('Escape'); // nothing typed: closes at once
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: /^Más acciones: Diplomado/ }).click();
  await page.getByRole('menuitem', { name: /^Periodos/ }).click();
  await expectNoHorizontalOverflow(page);
  await axe('periods dialog');
  assertClean();
});

/** Walks the "Agregar estudio" flow for an "Otro estudio" up to the level step. */
async function otherStudyUntilLevel(page: Page, name: string) {
  await page.goto('/settings/studies');
  await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar estudio' });
  await dialog.getByRole('button', { name: /Otro estudio/ }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByLabel('Nombre del estudio').fill(name);
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByLabel('Nombre del periodo').fill('Periodo 1');
  await dialog.getByLabel('Inicio', { exact: true }).fill(dates.startDate);
  await dialog.getByLabel('Fin', { exact: true }).fill(dates.endDate);
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await expect(
    dialog.getByRole('heading', { level: 3, name: '¿En qué nivel estás?' }),
  ).toBeVisible();
  return dialog;
}

test('"otro estudio" may have a level: a number (Técnico), words (Inglés B2) or none (Diplomado); they exclude each other and Atrás keeps them', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const levelOf = async (study: string) => {
    const tracks = (await get(page, '/api/study-tracks')).studyTracks;
    const id = tracks.find((t: { name: string }) => t.name === study).id;
    const period = (await get(page, '/api/periods')).periods.find(
      (p: { studyTrackId: string }) => p.studyTrackId === id,
    );
    return { studyLevel: period.studyLevel, studyLevelNote: period.studyLevelNote };
  };

  // 1) a technical program: level 2 (a number), shown on the confirmation and in the card
  let dialog = await otherStudyUntilLevel(page, 'Técnico en Sistemas');
  await expect(dialog.getByRole('button', { name: /^Nivel \d/ })).toHaveCount(0); // no "semestre" buttons for another study
  await expect(dialog).not.toContainText('Semestre');
  // the two fields exclude each other as they are typed
  await dialog.getByLabel('O descríbelo').fill('Módulo 3');
  await dialog.getByLabel(/^Número/).fill('2');
  await expect(dialog.getByLabel('O descríbelo')).toHaveValue('');
  await dialog.getByLabel('O descríbelo').fill('Módulo 3');
  await expect(dialog.getByLabel(/^Número/)).toHaveValue('');
  await dialog.getByLabel('O descríbelo').fill('');
  await dialog.getByLabel(/^Número/).fill('2');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click(); // no subjects
  await expect(dialog.getByText('Nivel 2')).toBeVisible(); // the confirmation shows the level that was given
  // Atrás twice keeps what was written
  await dialog.getByRole('button', { name: 'Atrás' }).click();
  await dialog.getByRole('button', { name: 'Atrás' }).click();
  await expect(dialog.getByLabel(/^Número/)).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Crear estudio' }).click();
  await expect(studyCard(page, 'Técnico en Sistemas')).toContainText('Nivel 2');
  expect(await levelOf('Técnico en Sistemas')).toEqual({ studyLevel: 2, studyLevelNote: null });

  // 2) a language course: the level is words ("B2")
  dialog = await otherStudyUntilLevel(page, 'Inglés');
  await dialog.getByLabel('O descríbelo').fill('B2');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await expect(dialog.getByText('B2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Crear estudio' }).click();
  await expect(studyCard(page, 'Inglés')).toContainText('B2');
  expect(await levelOf('Inglés')).toEqual({ studyLevel: null, studyLevelNote: 'B2' });

  // 3) a diploma with no level: "Ahora no" is valid, and so is Siguiente with nothing; the confirmation has no Nivel line
  dialog = await otherStudyUntilLevel(page, 'Diplomado');
  await dialog.getByRole('button', { name: 'Siguiente' }).click(); // nothing chosen: "no level", not an error
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Siguiente' }).click(); // subjects: none
  await expect(dialog.getByText('Nivel', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Atrás' }).click();
  await dialog.getByRole('button', { name: 'Atrás' }).click();
  await dialog.getByRole('button', { name: 'Ahora no' }).click();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Crear estudio' }).click();
  await expect(studyCard(page, 'Diplomado')).toBeVisible();
  expect(await levelOf('Diplomado')).toEqual({ studyLevel: null, studyLevelNote: null });
  assertClean();
});

test('with NO HOME (the main study has no current period, a secondary one does) the explicit subjects of that study still open; the plain page asks for a period', async ({
  page,
}) => {
  const assertClean = watch(page, ['404 /api/study-tracks/*']);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const a = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-2', ...dates },
    subjects: ['Farmacología'],
  });
  const b = await post(page, '/api/study-tracks/setup', {
    track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
    period: { name: 'Cohorte', ...dates },
    subjects: ['Seguridad de Redes'],
  });
  // the main study loses its current period (archiving clears it, restoring does not bring it back) and takes the main place again
  await post(page, `/api/study-tracks/${b.studyTrack.id}/make-primary`);
  await post(page, `/api/study-tracks/${a.studyTrack.id}/archive`);
  await post(page, `/api/study-tracks/${a.studyTrack.id}/restore`);
  await post(page, `/api/study-tracks/${a.studyTrack.id}/make-primary`);
  expect((await get(page, '/api/periods/home')).period).toBeNull(); // HOME: none
  expect((await get(page, '/api/periods/current')).periods).toHaveLength(1); // ...yet a secondary study has a current period

  // Mis estudios opens (it never needs HOME) and offers the secondary study's subjects
  await page.goto('/settings/studies');
  await expect(page).toHaveURL(/\/settings\/studies$/);
  await expect(page.getByText('todavía no tiene un periodo actual')).toBeVisible();
  await expect(studyCard(page, 'Medicina')).toContainText('Sin periodo actual');
  await page.getByRole('link', { name: 'Ver materias de Diplomado' }).click();
  await expect(page).toHaveURL(new RegExp(`/subjects\\?period=${b.period.id}$`)); // NOT the onboarding
  await expect(page.getByRole('heading', { level: 1, name: 'Mis asignaturas' })).toBeVisible();
  await expect(page.getByText(/^Diplomado · Cohorte/)).toBeVisible();
  await expect(page.getByText('Seguridad de Redes').first()).toBeVisible();

  // a new subject goes to THAT period, although it is not HOME
  await page.getByRole('button', { name: 'Agregar asignatura' }).first().click();
  const form = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await form.getByLabel('Nombre').fill('Ética');
  await form.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('Ética').first()).toBeVisible();
  const created = (await get(page, `/api/subjects?periodId=${b.period.id}`)).subjects.find(
    (x: { name: string }) => x.name === 'Ética',
  );
  expect(created).toMatchObject({ periodId: b.period.id });
  expect(
    (await get(page, `/api/subjects?periodId=${a.period.id}`)).subjects.map(
      (x: { name: string }) => x.name,
    ),
  ).toEqual(['Farmacología']);

  // a period that is not yours (or does not exist): the same message, and still not the onboarding
  await page.goto('/subjects?period=00000000-0000-4000-8000-000000000099');
  await expect(page).toHaveURL(/\/subjects\?period=/);
  await expect(page.getByText('No encontramos ese periodo.')).toBeVisible();

  // the PLAIN page still needs HOME: without one, the onboarding, as before
  await page.goto('/subjects');
  await expect(page).toHaveURL(/\/onboarding$/);
  assertClean();
});

test('every width from 320 to 1366: Mis estudios, its dialogs and its menu fit, with long names, and the keyboard works', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1366', 'sets its own widths: one project is enough');
  test.setTimeout(240_000);
  const assertClean = watch(page);
  const legacy = await legacyAccount(page);
  const LONG = 'Diplomado de especialización en seguridad informática y redes de computadores';
  await post(page, '/api/study-tracks/setup', {
    track: { name: LONG, type: 'OTHER_ACADEMIC' },
    period: { name: 'Cohorte de octubre a diciembre del año dos mil veintiséis', ...dates },
    subjects: ['Seguridad de Redes'],
  });
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-2', ...dates, studyLevel: 4 },
  });
  const axe = async (label: string) => {
    await entrancesDone(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      label,
    ).toEqual([]);
  };
  const fits = async (label: string) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${label}: horizontal overflow in px`).toBeLessThanOrEqual(0);
    // nothing important is wider than the screen
    const wide = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('dialog[open], main button, main a, dialog[open] button'),
      )
        .filter((e) => (e as HTMLElement).getBoundingClientRect().right > window.innerWidth + 1)
        .map((e) => (e.textContent ?? '').trim().slice(0, 30)),
    );
    expect(wide, `${label}: elements beyond the screen`).toEqual([]);
  };
  const tall = async (label: string) => {
    // touch targets of the visible controls are at least 44 px high
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('main button, dialog[open] button, main a[class*="min-h"]'),
      )
        .map((e) => e as HTMLElement)
        .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 43.5)
        .map(
          (e) =>
            `${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`,
        ),
    );
    expect(small, `${label}: controls under 44 px`).toEqual([]);
  };

  for (const width of [320, 360, 390, 430, 768, 1366]) {
    await page.setViewportSize({ width, height: 800 });
    const at = (what: string) => `${width}px ${what}`;
    await page.goto('/settings/studies');
    await expect(page.getByRole('heading', { level: 1, name: 'Mis estudios' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(2);
    await fits(at('list'));
    await tall(at('list'));

    // the action menu, by keyboard: Enter on the button opens it, focus goes inside, Escape gives the focus back
    const trigger = page.getByRole('button', { name: `Más acciones: ${LONG}`, exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await fits(at('action menu'));
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    // adopt (the plan of the older account), the wizard (type and program step) and the periods dialog
    await page.getByRole('button', { name: 'Convertir en estudio' }).click();
    const adopt = page.getByRole('dialog', { name: 'Convertir en estudio' });
    await fits(at('adopt dialog'));
    await tall(at('adopt dialog'));
    await adopt.getByRole('button', { name: 'Cancelar' }).click();
    await expect(adopt).toBeHidden();

    await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
    const wizard = page.getByRole('dialog', { name: 'Agregar estudio' });
    await expect(wizard.getByRole('heading', { level: 3 })).toBeFocused();
    await fits(at('wizard, type'));
    await tall(at('wizard, type'));
    await wizard.getByRole('button', { name: /Universidad/ }).click();
    await wizard.getByRole('button', { name: 'Siguiente' }).click();
    await fits(at('wizard, program'));
    await wizard.getByLabel('Carrera o programa').fill('Med');
    await fits(at('wizard, program with matches'));
    await tall(at('wizard, program with matches'));
    await page.keyboard.press('Escape'); // something was typed: it asks first
    await expect(wizard.getByRole('alert')).toContainText('cambios sin guardar');
    await wizard.getByRole('button', { name: 'Descartar cambios' }).click();
    await expect(wizard).toBeHidden();

    await page.getByRole('button', { name: `Más acciones: ${LONG}`, exact: true }).click();
    await page.getByRole('menuitem', { name: /^Periodos/ }).click();
    const periods = page.getByRole('dialog', { name: new RegExp('^Periodos de ') });
    await fits(at('periods dialog'));
    await tall(at('periods dialog'));
    await periods.getByRole('button', { name: 'Nuevo periodo' }).click();
    await fits(at('new period form'));
    await tall(at('new period form'));
    await page.keyboard.press('Escape');
    if (await periods.isVisible()) await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // the subjects of a study with a long name
    await page.getByRole('link', { name: `Ver materias de ${LONG}` }).click();
    await expect(page).toHaveURL(/\/subjects\?period=/);
    await fits(at('subjects of a study'));
  }
  // axe once at a narrow and once at a wide width, with a dialog open
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/settings/studies');
    await axe(`${width}px list`);
    await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
    await axe(`${width}px wizard`);
    await page.keyboard.press('Escape');
  }
  expect(legacy.period.id).toBeTruthy();
  assertClean();
});
