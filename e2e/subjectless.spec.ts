import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createPrisma } from '../apps/api/src/db/prisma';
import { getTestDatabaseUrl } from '../apps/api/test/testDb';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  entrancesDone,
  expectNoHorizontalOverflow,
  openActivityMenu,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * F1-1: an activity may have no subject. "Omitir asignatura" (action), "Sin asignatura" (state), "Elegir asignatura"
 * (restore) and "Sin asignatura" in the filter. The API rules are tested elsewhere; here is what the student sees and does.
 */

const PHONE = (page: Page) => page.viewportSize()!.width < 1024;
const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

async function newUser(page: Page, subjects: string[] = []) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page);
  for (const name of subjects) await addSubjectViaUi(page, name);
  return email;
}

const goActivities = async (page: Page) => {
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await expect(page).toHaveURL(/\/activities/);
  await expect(page.getByRole('heading', { name: 'Actividades', level: 1 })).toBeVisible();
};

const apiActivities = async (page: Page) =>
  (await (await page.request.get('/api/activities')).json()).activities as {
    id: string;
    title: string;
    subjectId: string | null;
    dueAt: string;
    status: string;
    type: string;
    priority: string;
  }[];

async function openAdd(page: Page) {
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog.getByLabel('Título')).toBeFocused();
  return dialog;
}

const subjectSelect = (dialog: ReturnType<Page['locator']>) =>
  dialog.getByRole('combobox', { name: 'Asignatura' });

test('with NO subjects an activity can still be added, as "Sin asignatura", without leaving the page', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page); // a current period and zero subjects
  await goActivities(page);

  // The old blocking message is gone: the list, the filters and the button are there.
  await expect(page.getByText('Primero agrega una asignatura.')).toHaveCount(0);
  await expect(page.getByText('Aún no tienes actividades.')).toBeVisible();
  const dialog = await openAdd(page);

  // It opens already as a general activity, says why, and offers nothing to choose.
  await expect(
    dialog.getByRole('group', { name: 'Asignatura' }).getByText('Sin asignatura'),
  ).toBeVisible();
  await expect(dialog.getByText('Aún no tienes asignaturas.')).toBeVisible();
  await expect(subjectSelect(dialog)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Elegir asignatura' })).toHaveCount(0);

  await dialog.getByLabel('Título').fill('Renovar matrícula');
  await dialog.getByLabel('Fecha').fill(daysFromNow(5));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page).toHaveURL(/\/activities/); // no redirect to Subjects
  await expect(card(page, 'Renovar matrícula')).toBeVisible();
  await expect(card(page, 'Renovar matrícula').getByText('Sin asignatura')).toBeVisible();
  const [created] = await apiActivities(page);
  expect(created).toMatchObject({ title: 'Renovar matrícula', subjectId: null });
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('omit the subject in one tap, restore it keeping the last choice, and save a general activity', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases']);
  const redes = (await apiSubjects(page)).find((s) => s.name === 'Redes')!;
  await goActivities(page);
  const dialog = await openAdd(page);

  // Normal mode first: the selector, and the discreet action under it. Never "Sin asignatura" by default.
  await expect(subjectSelect(dialog)).toBeVisible();
  await expect(dialog.getByText('Sin asignatura')).toHaveCount(0);
  const omit = dialog.getByRole('button', { name: 'Omitir asignatura' });
  await expect(omit).toBeVisible();
  expect(await omit.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  await subjectSelect(dialog).selectOption({ label: 'Redes' });
  await omit.click(); // ONE tap, no confirmation

  // The state: the selector is gone from the tree (nothing hidden to focus) and the way back has the focus.
  const group = dialog.getByRole('group', { name: 'Asignatura' });
  await expect(group.getByText('Sin asignatura')).toBeVisible();
  await expect(subjectSelect(dialog)).toHaveCount(0);
  const choose = dialog.getByRole('button', { name: 'Elegir asignatura' });
  await expect(choose).toBeFocused();
  expect(await choose.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(
    44,
  );
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  // Restore: the selector is back with the choice the student had made.
  await choose.click();
  await expect(subjectSelect(dialog)).toBeFocused();
  await expect(subjectSelect(dialog)).toHaveValue(redes.id);
  await expect(dialog.getByText('Sin asignatura')).toHaveCount(0);

  // Omit again and save: the subject is NOT sent (null), not the one that was left in the selector.
  await dialog.getByRole('button', { name: 'Omitir asignatura' }).click();
  await dialog.getByLabel('Título').fill('Cita con la tutora');
  await dialog.getByLabel('Fecha').fill(daysFromNow(3));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(card(page, 'Cita con la tutora').getByText('Sin asignatura')).toBeVisible();
  expect((await apiActivities(page))[0]).toMatchObject({
    title: 'Cita con la tutora',
    subjectId: null,
  });
  assertClean();
});

test('the subject is still required when it is not omitted', async ({ page }) => {
  await newUser(page, ['Redes', 'Bases']);
  await goActivities(page);
  const dialog = await openAdd(page);
  await dialog.getByLabel('Título').fill('Sin elegir');
  await dialog.getByLabel('Fecha').fill(daysFromNow(2));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Elige una asignatura.')).toBeVisible();
  expect(await apiActivities(page)).toHaveLength(0);
});

test('edit: a subject-bound activity becomes general (nothing else changes), and later gets a subject again', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases']);
  const [redes, bases] = [
    (await apiSubjects(page)).find((s) => s.name === 'Redes')!,
    (await apiSubjects(page)).find((s) => s.name === 'Bases')!,
  ];
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Parcial de Redes',
    dueDate: daysFromNow(6),
    type: 'EXAM',
    priority: 'HIGH',
  });
  const before = (await apiActivities(page))[0]!;
  await goActivities(page);
  await expect(card(page, 'Parcial de Redes').getByText('Redes', { exact: true })).toBeVisible();

  // Subject -> "Sin asignatura".
  await page.getByRole('button', { name: 'Editar Parcial de Redes', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(subjectSelect(dialog)).toHaveValue(redes.id);
  await dialog.getByRole('button', { name: 'Omitir asignatura' }).click();
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'Parcial de Redes').getByText('Sin asignatura')).toBeVisible();
  const detached = (await apiActivities(page))[0]!;
  expect(detached).toMatchObject({
    subjectId: null,
    dueAt: before.dueAt,
    status: before.status,
    type: before.type,
    priority: before.priority,
  });

  // A general activity opens as such, with no error, and "Elegir asignatura" brings the selector back.
  await page.getByRole('button', { name: 'Editar Parcial de Redes', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(
    dialog.getByRole('group', { name: 'Asignatura' }).getByText('Sin asignatura'),
  ).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Elegir asignatura' }).click();
  await subjectSelect(dialog).selectOption({ label: 'Bases' });
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'Parcial de Redes').getByText('Bases', { exact: true })).toBeVisible();
  await expect(card(page, 'Parcial de Redes').getByText('Sin asignatura')).toHaveCount(0);
  expect((await apiActivities(page))[0]!.subjectId).toBe(bases.id);

  // Editing a general activity without touching the subject keeps it general.
  await page.getByRole('button', { name: 'Editar Parcial de Redes', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await dialog.getByRole('button', { name: 'Omitir asignatura' }).click();
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Editar Parcial de Redes', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await dialog.getByLabel('Título').fill('Parcial de Redes (1)');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
  expect((await apiActivities(page))[0]).toMatchObject({
    title: 'Parcial de Redes (1)',
    subjectId: null,
  });
  assertClean();
});

test('a general activity can be completed, change state and be deleted like any other', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await apiCreateActivity(page, { title: 'Pagar la matrícula', dueDate: daysFromNow(4) });
  await goActivities(page);

  await card(page, 'Pagar la matrícula')
    .getByRole('button', { name: /^Completar/ })
    .click();
  await expect.poll(async () => (await apiActivities(page))[0]!.status).toBe('COMPLETED');
  await openActivityMenu(page, 'Pagar la matrícula');
  await page.getByRole('menuitem', { name: 'Eliminar Pagar la matrícula' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Pagar la matrícula?' });
  await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(await apiActivities(page)).toHaveLength(0);
  assertClean();
});

test('the "Sin asignatura" filter: always offered, lives in the URL, survives a reload, combines and clears', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases']);
  const subjects = await apiSubjects(page);
  const id = (name: string) => subjects.find((s) => s.name === name)!.id;
  await apiCreateActivity(page, {
    subjectId: id('Redes'),
    title: 'Con Redes',
    dueDate: daysFromNow(3),
  });
  await apiCreateActivity(page, {
    subjectId: id('Bases'),
    title: 'Con Bases',
    dueDate: daysFromNow(4),
  });
  await apiCreateActivity(page, { title: 'General suelta', dueDate: daysFromNow(5) });
  await goActivities(page);
  await expect(
    page.getByRole('listitem').filter({ hasText: /Con Redes|Con Bases|General suelta/ }),
  ).toHaveCount(3);

  const openPanel = async () => {
    const toggle = page.getByRole('button', { name: /^Más filtros/ });
    if (PHONE(page) && (await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
  };
  await openPanel();
  const filter = page.locator('#filter-subject');
  // The option is there even before any general activity matters, as the last one.
  await expect(filter.locator('option').last()).toHaveText('Sin asignatura');

  await filter.selectOption({ label: 'Sin asignatura' });
  await expect(page).toHaveURL(/subject=none/);
  await expect(card(page, 'General suelta')).toBeVisible();
  await expect(card(page, 'Con Redes')).toHaveCount(0);
  await expect(card(page, 'Con Bases')).toHaveCount(0);

  // It coexists with the other filters (here, the state chip).
  await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
  await expect(page).toHaveURL(/subject=none/);
  await expect(page).toHaveURL(/status=PENDING/);
  await expect(card(page, 'General suelta')).toBeVisible();

  // Survives a reload (the panel opens by itself when a filter arrives in the link).
  await page.reload();
  await expect(card(page, 'General suelta')).toBeVisible();
  await expect(card(page, 'Con Redes')).toHaveCount(0);
  await openPanel();
  await expect(page.locator('#filter-subject')).toHaveValue('none');

  // Clearing leaves nothing behind.
  await page.locator('#filter-subject').selectOption({ label: 'Todas' });
  await expect(page).not.toHaveURL(/subject=/);
  await expect(
    page.getByRole('listitem').filter({ hasText: /Con Redes|Con Bases|General suelta/ }),
  ).toHaveCount(3);

  // A link straight to it works, and so does "Limpiar filtros" when nothing matches.
  await page.goto('/activities?subject=none&priority=LOW');
  await expect(page.getByText('No hay actividades que coincidan con los filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).first().click();
  await expect(page).not.toHaveURL(/subject=/);
  await expect(card(page, 'Con Redes')).toBeVisible();
  assertClean();
});

test('Home, the Radar and the lists show a general activity with its fallback and no error', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  await apiCreateActivity(page, { title: 'Trámite vencido', dueDate: daysFromNow(-2) });
  await apiCreateActivity(page, {
    title: 'Trámite de mañana',
    dueDate: daysFromNow(1),
    dueTime: '09:00',
  });
  await apiCreateActivity(page, { title: 'Trámite lejano', dueDate: daysFromNow(40) });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await entrancesDone(page);
  await expect(page.getByText('Sin asignatura').first()).toBeVisible(); // the hero / next delivery / lists
  await expect(page.getByText('Trámite vencido').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // The Radar categories list them, classified by deadline like any other.
  await page.goto('/activities?radar=OVERDUE');
  await expect(card(page, 'Trámite vencido').getByText('Sin asignatura')).toBeVisible();
  await expect(
    card(page, 'Trámite vencido').getByText('Vencida', { exact: false }).first(),
  ).toBeVisible();
  await page.goto('/activities?radar=UNDER_CONTROL');
  await expect(card(page, 'Trámite lejano').getByText('Sin asignatura')).toBeVisible();

  // Progress counts them in the general figure, with no row of their own.
  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('0 de 3 actividades completadas')).toBeVisible();
  await expect(page.getByText(/Incluye 3 actividades sin asignatura/)).toBeVisible();
  assertClean();
});

async function makeDue(email: string) {
  const prisma = createPrisma(getTestDatabaseUrl());
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { count } = await prisma.reminder.updateMany({
      where: { userId: user.id, status: 'PENDING' },
      data: { remindAt: new Date(Date.now() - 60_000) },
    });
    return count;
  } finally {
    await prisma.$disconnect();
  }
}

test('the reminders panel shows the reminder of a general activity, with the fallback', async ({
  page,
}) => {
  const assertClean = watch(page);
  const email = await newUser(page);
  await apiCreateActivity(page, {
    title: 'Entregar documento',
    dueDate: daysFromNow(10),
    type: 'EXAM',
  });
  expect(await makeDue(email)).toBeGreaterThan(0);

  await page.goto('/dashboard');
  const panel = page.getByRole('region', { name: 'Recordatorios' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Entregar documento').first()).toBeVisible();
  await expect(panel.getByText('Sin asignatura').first()).toBeVisible();
  assertClean();
});

test('a general activity downloads its calendar file with just its title', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page);
  await apiCreateActivity(page, {
    title: 'Cita con el tutor',
    dueDate: daysFromNow(8),
    dueTime: '15:00',
  });
  await goActivities(page);

  const [response, file] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/calendar.ics')),
    page.waitForEvent('download'),
    openActivityMenu(page, 'Cita con el tutor').then(() =>
      page
        .getByRole('menuitem', { name: 'Añadir al calendario: Cita con el tutor', exact: true })
        .click(),
    ),
  ]);
  expect(response.status()).toBe(200);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text.replaceAll('\r\n ', '').split('\r\n')).toContain('SUMMARY:Cita con el tutor');
  expect(text).not.toContain('Sin asignatura');
  assertClean();
});

test('keyboard and accessibility: both buttons are reachable, the focus follows the swap, axe is clean in both modes', async ({
  page,
}) => {
  await newUser(page, ['Redes', 'Bases']);
  await goActivities(page);
  const dialog = await openAdd(page);
  await entrancesDone(page);

  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Keyboard: select -> "Omitir asignatura" (the next stop), Enter swaps and keeps the focus on the way back.
  await subjectSelect(dialog).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Omitir asignatura' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Elegir asignatura' })).toBeFocused();
  await entrancesDone(page);
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.keyboard.press('Space');
  await expect(subjectSelect(dialog)).toBeFocused();

  // The dialog still asks before throwing away what was typed.
  await dialog.getByLabel('Título').fill('Algo escrito');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/descartar/i).first()).toBeVisible();
});
