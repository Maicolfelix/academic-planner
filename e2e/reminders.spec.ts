import { expect, test, type Locator, type Page } from '@playwright/test';
import { createPrisma } from '../apps/api/src/db/prisma';
import { getTestDatabaseUrl } from '../apps/api/test/testDb';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

async function newUserWithSubject(page: Page, subjectName = 'Redes') {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page);
  await addSubjectViaUi(page, subjectName);
  return email;
}

/** Creates an activity through the dialog, like a student would. `type` is chosen in "Más opciones". */
async function createViaUi(page: Page, title: string, date: string, time: string, type: string) {
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Fecha').fill(date);
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Hora (opcional)').fill(time);
  await dialog.getByLabel('Tipo').selectOption({ label: type });
  return dialog;
}

async function openEdit(page: Page, title: string) {
  await page.getByRole('button', { name: `Editar ${title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  const section = dialog.getByRole('region', { name: 'Recordatorios' });
  await expect(section).toBeVisible();
  return { dialog, items: section.getByRole('listitem'), section };
}

async function saveEdit(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
}

/** Makes reminders "due" the way time would: moves remindAt into the past directly in the TEST database. */
async function makeDue(email: string, where: { kind?: 'AUTO' | 'MANUAL'; offsetMinutes?: number }) {
  const prisma = createPrisma(getTestDatabaseUrl());
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { count } = await prisma.reminder.updateMany({
      where: { userId: user.id, status: 'PENDING', ...where },
      data: { remindAt: new Date(Date.now() - 60_000) },
    });
    return count;
  } finally {
    await prisma.$disconnect();
  }
}

test('reminders flow: automatic on create, recalculation, manual, complete/reopen, due panel, mark seen', async ({
  page,
}) => {
  const assertClean = watch(page, ['400 /api/reminders']);
  const email = await newUserWithSubject(page);
  await nav(page).getByRole('link', { name: 'Actividades' }).click();

  // 1-2. Creating an EXAM asks nothing about reminders (only a note that they are automatic).
  const create = await createViaUi(page, 'Parcial de Redes', daysFromNow(10), '10:00', 'Parcial');
  await expect(create.getByRole('heading', { name: 'Recordatorios' })).toHaveCount(0);
  await expect(create.getByRole('button', { name: /recordatorio/i })).toHaveCount(0);
  await expect(create.getByText('Los recordatorios se crean solos según el tipo')).toBeVisible();
  await create.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(create).toBeHidden();

  // 3. Editing shows the three automatic reminders of an EXAM, in order, as text (not colour).
  let { dialog, items } = await openEdit(page, 'Parcial de Redes');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Automático, 3 días antes');
  await expect(items.nth(1)).toContainText('Automático, 1 día antes');
  await expect(items.nth(2)).toContainText('Automático, 3 horas antes');
  for (const i of [0, 1, 2]) await expect(items.nth(i)).toContainText('Pendiente');
  const originalTimes = await items.allInnerTexts();

  // 4. A new deadline recalculates every automatic reminder.
  await dialog.getByLabel('Fecha', { exact: true }).fill(daysFromNow(14));
  await saveEdit(dialog);
  ({ dialog, items } = await openEdit(page, 'Parcial de Redes'));
  await expect(items).toHaveCount(3);
  const movedTimes = await items.allInnerTexts();
  expect(movedTimes).not.toEqual(originalTimes);
  for (const [i, text] of movedTimes.entries())
    expect(text.split('\n')[0], `reminder ${i} moved`).not.toBe(originalTimes[i]!.split('\n')[0]);

  // 5. A manual reminder: invalid first (after the deadline), then valid.
  await dialog.getByRole('button', { name: '+ Agregar recordatorio' }).click();
  await dialog.getByLabel('Fecha del recordatorio').fill(daysFromNow(15));
  await dialog.getByLabel('Hora del recordatorio').fill('09:00');
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(
    dialog.getByText('El recordatorio debe ser anterior a la fecha límite de la actividad.'),
  ).toBeVisible();
  await expect(items).toHaveCount(3);
  await dialog.getByLabel('Fecha del recordatorio').fill(daysFromNow(2));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(items).toHaveCount(4);
  await expect(items.filter({ hasText: 'Manual' })).toHaveCount(1);
  const withManual = await items.allInnerTexts();
  await dialog.getByRole('button', { name: 'Cancelar' }).first().click(); // nothing left to save
  await expect(page.getByRole('dialog')).toBeHidden();

  // 6. Changing only the title does not touch the reminders.
  ({ dialog } = await openEdit(page, 'Parcial de Redes'));
  await dialog.getByLabel('Título').fill('Parcial final de Redes');
  await saveEdit(dialog);
  ({ dialog, items } = await openEdit(page, 'Parcial final de Redes'));
  expect(await items.allInnerTexts()).toEqual(withManual);
  await dialog.getByRole('button', { name: 'Cancelar' }).first().click();

  // 7. Completing the activity cancels its pending reminders; no new ones can be added.
  await page.getByLabel('Cambiar estado de Parcial final de Redes').selectOption('Finalizada');
  await expect(page.getByLabel('Cambiar estado de Parcial final de Redes')).toHaveValue(
    'COMPLETED',
  );
  ({ dialog, items } = await openEdit(page, 'Parcial final de Redes'));
  await expect(items).toHaveCount(4);
  for (const i of [0, 1, 2, 3]) await expect(items.nth(i)).toContainText('Cancelado');
  await expect(dialog.getByRole('button', { name: '+ Agregar recordatorio' })).toHaveCount(0);
  await expect(dialog.getByText('La actividad está finalizada')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).first().click();

  // 8. Reopening brings the future ones back (3 automatic + the manual one).
  await page.getByLabel('Cambiar estado de Parcial final de Redes').selectOption('Pendiente');
  await expect(page.getByLabel('Cambiar estado de Parcial final de Redes')).toHaveValue('PENDING');
  ({ dialog, items } = await openEdit(page, 'Parcial final de Redes'));
  await expect(items).toHaveCount(4);
  await expect(items.filter({ hasText: 'Pendiente' })).toHaveCount(4);
  await expect(items.filter({ hasText: 'Cancelado' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancelar' }).first().click();

  // 9. Nothing is due yet: no panel, no badge.
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('heading', { name: 'Recordatorios' })).toHaveCount(0);

  // 10. Simulate time passing: two reminders come due (one automatic, one manual).
  expect(await makeDue(email, { kind: 'AUTO', offsetMinutes: -4320 })).toBe(1);
  expect(await makeDue(email, { kind: 'MANUAL' })).toBe(1);
  await page.reload();
  const panel = page.getByRole('region', { name: 'Recordatorios' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Recordatorios' })).toBeVisible();
  await expect(panel.getByText('Tienes 2 recordatorios')).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByRole('listitem').first()).toContainText('Parcial final de Redes');
  await expect(panel.getByText('Redes', { exact: true }).first()).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /Inicio/ })).toContainText('🔔 2');

  // Reading the panel never marks anything: after a reload they are still there.
  await page.reload();
  await expect(panel.getByText('Tienes 2 recordatorios')).toBeVisible();

  // 11. Mark one as seen, then the other; the panel and the badge disappear and stay gone.
  await panel
    .getByRole('button', { name: /Marcar como visto: Parcial final de Redes/ })
    .first()
    .click();
  await expect(panel.getByText('Tienes 1 recordatorio', { exact: true })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /Inicio/ })).toContainText('🔔 1');
  await page.reload();
  await expect(panel.getByText('Tienes 1 recordatorio', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /Marcar como visto/ }).click();
  await expect(page.getByRole('heading', { name: 'Recordatorios' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recordatorios' })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Inicio' })).not.toContainText('🔔');

  // The seen ones show as "Mostrado" in the activity.
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  ({ items } = await openEdit(page, 'Parcial final de Redes'));
  await expect(items.filter({ hasText: 'Mostrado' })).toHaveCount(2);
  await expect(items.filter({ hasText: 'Pendiente' })).toHaveCount(2);

  assertClean();
});

test('"Marcar todos como vistos" clears the panel in one action', async ({ page }) => {
  const assertClean = watch(page);
  const email = await newUserWithSubject(page);
  const [subject] = await apiSubjects(page);
  for (const title of ['Lectura 1', 'Lectura 2', 'Lectura 3'])
    await apiCreateActivity(page, {
      subjectId: subject!.id,
      title,
      type: 'READING',
      dueDate: daysFromNow(5),
      dueTime: '10:00',
    });
  expect(await makeDue(email, {})).toBe(3);

  await page.goto('/dashboard');
  const panel = page.getByRole('region', { name: 'Recordatorios' });
  await expect(panel.getByText('Tienes 3 recordatorios')).toBeVisible();
  await panel.getByRole('button', { name: 'Marcar todos como vistos' }).click();
  await expect(page.getByRole('heading', { name: 'Recordatorios' })).toHaveCount(0);

  assertClean();
});

test('reminders are placed in the user’s timezone, whatever the browser’s', async ({ browser }) => {
  // The browser is in Tokyo (UTC+9); the profile is Bogotá (UTC-5). 10:00 means 10:00 in Bogotá.
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await page.goto('/activities');

  const create = await createViaUi(page, 'Examen con hora', daysFromNow(10), '10:00', 'Parcial');
  await create.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(create).toBeHidden();

  const { dialog, items } = await openEdit(page, 'Examen con hora');
  await expect(items).toHaveCount(3);
  // 1 day before = same wall clock, a day earlier; 3 hours before = 07:00 (never 22:00 / 19:00 Tokyo).
  await expect(items.nth(1)).toContainText(/10:00/);
  await expect(items.nth(2)).toContainText(/7:00/);

  // Editing a reminder shows the same wall-clock back, and the edit keeps it (becomes manual).
  await items
    .nth(2)
    .getByRole('button', { name: /Editar recordatorio/ })
    .click();
  await expect(dialog.getByLabel('Hora del recordatorio')).toHaveValue('07:00');
  await dialog.getByLabel('Hora del recordatorio').fill('08:30');
  await dialog.getByRole('button', { name: 'Guardar recordatorio' }).click();
  await expect(items.filter({ hasText: 'Manual' })).toHaveCount(1);
  await expect(items.filter({ hasText: /8:30/ })).toHaveCount(1);

  assertClean();
  await context.close();
});

test('layout: the panel and the reminder section stay readable with long content', async ({
  page,
}) => {
  const assertClean = watch(page);
  const email = await newUserWithSubject(page, 'Asignatura con un nombre bastante largo de verdad');
  const [subject] = await apiSubjects(page);
  const long = 'Entrega ' + 'muy larga '.repeat(8) + 'Supercalifragilisticoespialidosoynadamás';
  await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: long,
    type: 'EXAM',
    dueDate: daysFromNow(10),
    dueTime: '10:00',
  });
  expect(await makeDue(email, { offsetMinutes: -4320 })).toBe(1);

  await page.goto('/dashboard');
  const panel = page.getByRole('region', { name: 'Recordatorios' });
  await expect(panel.getByText('Tienes 1 recordatorio', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const seen = panel.getByRole('button', { name: /Marcar como visto/ });
  expect((await seen.boundingBox())!.height).toBeGreaterThanOrEqual(44); // comfortable touch target
  expect(await panel.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(
    true,
  );

  await page.goto('/activities');
  await page.getByRole('button', { name: /^Editar / }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(dialog.getByRole('heading', { name: 'Recordatorios' })).toBeVisible();
  await dialog.getByRole('button', { name: '+ Agregar recordatorio' }).click();
  await expectNoHorizontalOverflow(page);
  // Every control has an accessible name.
  for (const button of await dialog.getByRole('button').all())
    expect((await button.getAttribute('aria-label')) ?? (await button.innerText())).toMatch(/\S/);

  assertClean();
});
