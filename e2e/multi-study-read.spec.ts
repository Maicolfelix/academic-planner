import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  bogotaToday,
  daysFromNow,
  completeOnboarding,
  entrancesDone,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * The summaries read ALL the current, active periods, and the HOME period stays the home of everything that is written. The
 * studies are set up by the API (there is no studies screen yet); the browser must show what the server reads.
 */
test.setTimeout(60_000); // each test sets up two studies through the API: the default 30 s is too tight on a cold stack
const MEDICINA = 'Medicina';
const DIPLOMADO = 'Diplomado en Ciberseguridad';

const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};

/** Two studies, each with a current period, a subject, an activity and a class today. Medicina is the primary one (HOME). */
async function twoStudies(page: Page, diploma = DIPLOMADO) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const medicina = (await post(page, '/api/study-tracks', { name: MEDICINA, type: 'UNIVERSITY' }))
    .studyTrack;
  const second = (await post(page, '/api/study-tracks', { name: diploma, type: 'OTHER_ACADEMIC' }))
    .studyTrack;
  const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };
  const pm = (
    await post(page, '/api/periods', { name: '2026-2', ...dates, studyTrackId: medicina.id })
  ).period;
  const pd = (
    await post(page, '/api/periods', { name: 'Cohorte oct–dic', ...dates, studyTrackId: second.id })
  ).period;
  const farma = (await post(page, '/api/subjects', { periodId: pm.id, name: 'Farmacología' }))
    .subject;
  const redes = (await post(page, '/api/subjects', { periodId: pd.id, name: 'Seguridad de Redes' }))
    .subject;
  await post(page, '/api/activities', {
    subjectId: farma.id,
    title: 'Parcial de Farmacología',
    dueDate: bogotaToday(3),
    type: 'EXAM',
  });
  await post(page, '/api/activities', {
    subjectId: redes.id,
    title: 'Proyecto final Diplomado',
    dueDate: bogotaToday(4),
  });
  await post(page, '/api/schedule', {
    type: 'CLASS',
    periodId: pm.id,
    subjectId: farma.id,
    title: 'Clase de Farmacología',
    date: bogotaToday(0),
    startTime: '06:00',
    endTime: '07:00',
  });
  await post(page, '/api/schedule', {
    type: 'CLASS',
    periodId: pd.id,
    subjectId: redes.id,
    title: 'Sesión de Redes',
    date: bogotaToday(0),
    startTime: '20:00',
    endTime: '21:00',
  });
  return { medicina, second, pm, pd };
}

test('Home: the activities of BOTH studies are on it, it says what it reads, and each item says its study', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/); // HOME (Medicina) lets the user in
  await entrancesDone(page);
  await expect(
    page.getByText(`En tus estudios actuales: ${MEDICINA} · ${DIPLOMADO}`),
  ).toBeVisible();
  await expect(page.getByText('Parcial de Farmacología').first()).toBeVisible();
  await expect(page.getByText('Proyecto final Diplomado').first()).toBeVisible();
  // the labels are text: each item names its study (the screen reader hears "Estudio: …")
  const row = page.locator('li', { hasText: 'Proyecto final Diplomado' }).first();
  await expect(row).toContainText(DIPLOMADO);
  await expect(row.getByText('Estudio:')).toHaveCount(1);
  await expect(page.getByText('Resumen de tus estudios actuales')).toHaveCount(1);
  assertClean();
});

test('Radar: both studies are read, in one list, with the same words as always', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);
  await page.goto('/radar');
  await expect(page.getByRole('heading', { level: 1, name: 'Radar académico' })).toBeVisible();
  await expect(
    page.getByText(`En tus estudios actuales: ${MEDICINA} · ${DIPLOMADO}`),
  ).toBeVisible();
  await expect(page.getByText('Parcial de Farmacología')).toBeVisible();
  await expect(page.getByText('Proyecto final Diplomado')).toBeVisible();
  await expect(page.locator('li', { hasText: 'Parcial de Farmacología' }).first()).toContainText(
    MEDICINA,
  );
  assertClean();
});

test('Progress: one overall count, one line per study, and the subjects say their study', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);
  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 3, name: 'Por periodo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Por estudio' })).toHaveCount(0);
  const byStudy = page.getByRole('region', { name: 'Por periodo' });
  await expect(byStudy).toContainText(MEDICINA);
  await expect(byStudy).toContainText(DIPLOMADO);
  await expect(byStudy.getByText('0 de 1 completadas')).toHaveCount(2); // each study counts its own activity
  await expect(page.getByText('0 de 2 actividades completadas')).toBeVisible(); // the overall one
  await expect(page.getByText('en tus estudios actuales').first()).toBeVisible();
  await expect(page.getByText('Seguridad de Redes').first()).toBeVisible();
  assertClean();
});

test('the Agenda stays global: the classes of both studies are on the same day, and archived history is not hidden', async ({
  page,
}) => {
  const assertClean = watch(page);
  const { second } = await twoStudies(page);
  await page.goto('/calendar');
  await expect(page.getByText('Clase de Farmacología').first()).toBeVisible();
  await expect(page.getByText('Sesión de Redes').first()).toBeVisible();
  await post(page, `/api/study-tracks/${second.id}/archive`);
  await page.reload();
  // the Agenda is a calendar of everything that exists: archiving a study does not erase its classes from it
  await expect(page.getByText('Sesión de Redes').first()).toBeVisible();
  assertClean();
});

test('archiving a study takes it out of the current summaries (Home and Radar), and the label goes away with it', async ({
  page,
}) => {
  const assertClean = watch(page);
  const { second } = await twoStudies(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Proyecto final Diplomado').first()).toBeVisible();
  await post(page, `/api/study-tracks/${second.id}/archive`);
  await page.goto('/dashboard');
  await entrancesDone(page);
  await expect(page.getByText('Parcial de Farmacología').first()).toBeVisible();
  await expect(page.getByText('Proyecto final Diplomado')).toHaveCount(0);
  await expect(page.getByText('En tus estudios actuales')).toHaveCount(0); // one study left: the copy is the one-period one
  await expect(page.getByText('Estudio:')).toHaveCount(0);
  await page.goto('/radar');
  await expect(page.getByText('Proyecto final Diplomado')).toHaveCount(0);
  assertClean();
});

test('an account with ONE period sees exactly what it always saw: no study line, no labels, the old words', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await entrancesDone(page);
  await expect(page.getByText('En tus estudios actuales')).toHaveCount(0);
  await expect(page.getByText('Estudio:')).toHaveCount(0);
  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 3, name: 'Por periodo' })).toHaveCount(0);
  assertClean();
});

test('with two studies nothing overflows and nothing is wrong for assistive technology (even with a very long study name)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertClean = watch(page);
  await twoStudies(
    page,
    'Diplomado de especialización en seguridad informática y redes de computadores',
  );
  for (const path of ['/dashboard', '/radar', '/progress', '/calendar']) {
    await page.goto(path);
    await entrancesDone(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      path,
    ).toEqual([]);
  }
  assertClean();
});

test('Home → Actividades: the counter of pending leads to a list with the activities of BOTH studies, each with its study', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);
  await page.goto('/dashboard');
  await entrancesDone(page);
  // the counter is global (both studies' pending activities) and the list it leads to is the same scope
  await page
    .getByRole('link', { name: /Pendientes/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/activities\?status=PENDING$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Actividades' })).toBeVisible();
  await expect(page.getByText('Todos tus estudios actuales')).toBeVisible();
  const farma = page.locator('li', { hasText: 'Parcial de Farmacología' }).first();
  const redes = page.locator('li', { hasText: 'Proyecto final Diplomado' }).first();
  await expect(farma).toBeVisible();
  await expect(redes).toBeVisible();
  await expect(farma).toContainText(MEDICINA);
  await expect(redes).toContainText(DIPLOMADO);
  await expect(farma.getByText('Estudio:')).toHaveCount(1); // text for a screen reader, not a colour
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('a general period plus ONE study: the study’s activity is labelled and the general one is not', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };
  const medicina = (await post(page, '/api/study-tracks', { name: MEDICINA, type: 'UNIVERSITY' }))
    .studyTrack;
  const general = (await post(page, '/api/periods', { name: 'Mi planificación', ...dates })).period;
  const pm = (
    await post(page, '/api/periods', { name: '2026-2', ...dates, studyTrackId: medicina.id })
  ).period;
  const farma = (await post(page, '/api/subjects', { periodId: pm.id, name: 'Farmacología' }))
    .subject;
  await post(page, '/api/activities', {
    subjectId: farma.id,
    title: 'Parcial de Farmacología',
    dueDate: bogotaToday(3),
  });
  await post(page, '/api/activities', { title: 'Trámite general', dueDate: bogotaToday(2) }); // no subject: HOME = the general period
  expect(general.isCurrent).toBe(true);
  await page.goto('/activities');
  await expect(page.locator('li', { hasText: 'Parcial de Farmacología' }).first()).toContainText(
    MEDICINA,
  );
  await expect(page.locator('li', { hasText: 'Trámite general' }).first()).not.toContainText(
    MEDICINA,
  );
  await expect(page.getByText('Estudio:')).toHaveCount(1); // only the study's item carries a label; never "Sin estudio"
  await expect(page.getByText('Sin estudio')).toHaveCount(0);
  assertClean();
});

test('creating from Activities still goes to HOME; editing the other study’s activity offers THAT period’s subjects and keeps its period', async ({
  page,
}) => {
  const assertClean = watch(page);
  const { pm, pd } = await twoStudies(page);
  await page.goto('/activities');
  // CREATE: a new activity, with no subject, lands in the HOME period (Medicina, the primary study)
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const add = page.getByRole('dialog', { name: 'Agregar actividad' });
  const subjectOptions = await add
    .getByRole('combobox', { name: 'Asignatura' })
    .locator('option')
    .allTextContents();
  expect(subjectOptions.join('|')).toContain('Farmacología'); // the HOME subjects...
  expect(subjectOptions.join('|')).not.toContain('Seguridad de Redes'); // ...never the other study's
  await add.getByRole('button', { name: 'Omitir asignatura' }).click();
  await add.getByLabel('Título').fill('Trámite nuevo');
  await add.getByLabel('Fecha').fill(daysFromNow(5));
  await add.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(add).toBeHidden();
  const home = (await (await page.request.get('/api/periods/home')).json()).period as {
    id: string;
  };
  expect(home.id).toBe(pm.id);
  const created = (
    (await (await page.request.get('/api/activities?scope=current')).json()).activities as {
      id: string;
      title: string;
      periodId: string;
    }[]
  ).find((a) => a.title === 'Trámite nuevo')!;
  expect(created.periodId).toBe(home.id);

  // EDIT: the Diplomado activity opens with the Diplomado subjects, and saving never moves it
  await page.getByRole('button', { name: 'Editar Proyecto final Diplomado', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(edit.getByRole('combobox', { name: 'Asignatura' })).toBeVisible(); // its own subjects load first
  const editOptions = await edit
    .getByRole('combobox', { name: 'Asignatura' })
    .locator('option')
    .allTextContents();
  expect(editOptions.join('|')).toContain('Seguridad de Redes');
  expect(editOptions.join('|')).not.toContain('Farmacología');
  await edit.getByLabel('Título').fill('Proyecto final editado');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toBeHidden();
  const after = (
    (await (await page.request.get('/api/activities?scope=current')).json()).activities as {
      title: string;
      periodId: string;
    }[]
  ).find((a) => a.title === 'Proyecto final editado')!;
  expect(after.periodId).toBe(pd.id);
  assertClean();
});

test('archiving a study takes its activities out of the Activities list (and the label with them)', async ({
  page,
}) => {
  const assertClean = watch(page);
  const { second } = await twoStudies(page);
  await page.goto('/activities');
  await expect(page.getByText('Proyecto final Diplomado').first()).toBeVisible();
  await post(page, `/api/study-tracks/${second.id}/archive`);
  await page.reload();
  await expect(page.getByText('Parcial de Farmacología').first()).toBeVisible();
  await expect(page.getByText('Proyecto final Diplomado')).toHaveCount(0);
  await expect(page.getByText('Estudio:')).toHaveCount(0);
  await expect(page.getByText('Todos tus estudios actuales')).toHaveCount(0);
  assertClean();
});
