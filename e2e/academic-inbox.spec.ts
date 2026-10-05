import { weekdayOf } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });

// Weekday names of tomorrow and the day after: they always resolve to those days, whatever time the test runs at.
const D1 = bogotaToday(1);
const D2 = bogotaToday(2);
const DAY_NAMES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const name1 = DAY_NAMES[weekdayOf(D1) - 1]!;
const name2 = DAY_NAMES[weekdayOf(D2) - 1]!;

async function newUser(page: Page, subjects: string[]) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  for (const name of subjects) await addSubjectViaUi(page, name);
}

const textbox = (page: Page) => page.getByLabel('Mensaje del profesor o instrucción académica');
const results = (page: Page) => page.getByRole('region', { name: /propuesta|Sin actividades/ });
const cards = (page: Page) => page.getByRole('article');
const card = (page: Page, n: number) => cards(page).nth(n);

async function interpret(page: Page, text: string) {
  await page.goto('/inbox');
  await textbox(page).fill(text);
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(results(page)).toBeVisible();
}

const activities = async (page: Page) =>
  (await (await page.request.get('/api/activities')).json()).activities as {
    id: string;
    title: string;
    type: string;
    dueAt: string;
  }[];

test('paste -> interpret -> review -> confirm, one by one, down to Dashboard and Activities', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases de Datos']);

  // Dashboard: discreet access, no big textarea.
  await page.goto('/dashboard');
  await expect(page.getByText('¿Tienes un mensaje del profesor? Pégalo aquí.')).toBeVisible();
  expect(await page.locator('textarea').count()).toBe(0);
  await page.getByRole('link', { name: 'Interpretar mensaje' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Bandeja académica' })).toBeVisible();
  await expect(textbox(page)).toHaveAttribute(
    'placeholder',
    'Pega aquí un mensaje de tu profesor o una instrucción académica…',
  );

  await interpret(
    page,
    `Buenas tardes. El ${name1} tendremos parcial de Redes a las 10am y el ${name2} debemos entregar el taller de Bases.`,
  );
  expect(await activities(page)).toHaveLength(0); // interpreting never saves
  await expect(results(page)).toBeFocused();
  await expect(cards(page)).toHaveCount(2);

  await expect(card(page, 0).getByLabel('Tipo')).toHaveValue('EXAM');
  await expect(card(page, 0).getByLabel('Fecha')).toHaveValue(D1);
  await expect(card(page, 0).getByLabel('Hora (opcional)')).toHaveValue('10:00');
  await expect(card(page, 0)).toContainText('Texto detectado');
  await expect(card(page, 1).getByLabel('Tipo')).toHaveValue('WORKSHOP');
  await expect(card(page, 1).getByLabel('Fecha')).toHaveValue(D2);
  await expectNoHorizontalOverflow(page);

  // Edit the second title, uncheck it, create only the first.
  await card(page, 1).getByLabel('Título').fill('Taller final');
  await card(page, 1)
    .getByLabel(/Incluir/)
    .uncheck();
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 creada, 0 pendientes' }),
  ).toBeVisible();
  expect(await activities(page)).toHaveLength(1);
  await expect(card(page, 0)).toContainText('Actividad creada');

  // Now the second one (the created card cannot be created twice).
  await card(page, 1)
    .getByLabel(/Incluir/)
    .check();
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 creada, 0 pendientes' }),
  ).toBeVisible();
  const all = await activities(page);
  expect(all.map((a) => a.title).sort()).toEqual(['Parcial', 'Taller final']);
  await expect(page.getByRole('button', { name: 'Crear seleccionadas' })).toBeDisabled();

  await page.goto('/activities');
  await expect(page.getByText('Taller final').first()).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  assertClean();
});

test('two similar subjects: the student chooses', async ({ page }) => {
  await newUser(page, ['Programación I', 'Programación II']);
  await interpret(page, `El ${name1} tendremos parcial de Programación.`);
  await expect(card(page, 0).getByRole('group', { name: '¿A cuál te refieres?' })).toBeVisible();
  await expect(card(page, 0).getByLabel('Asignatura')).toHaveValue('');
  await expect(card(page, 0)).toContainText('Para crearla falta la asignatura');
  await card(page, 0).getByLabel('Programación II').check();
  await card(page, 0)
    .getByLabel(/Incluir/)
    .check();
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(card(page, 0)).toContainText('Actividad creada');
});

test('an incomplete proposal keeps what was understood and is not created blindly', async ({
  page,
}) => {
  await newUser(page, ['Redes']);
  await interpret(page, `Entregar taller el ${name1}.`);
  await expect(card(page, 0).getByLabel('Fecha')).toHaveValue(D1);
  await expect(card(page, 0)).toContainText('Incompleta');
  await expect(card(page, 0).getByLabel(/Incluir/)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Crear seleccionadas' })).toBeDisabled();
  await card(page, 0).getByLabel('Asignatura').selectOption({ label: 'Redes' });
  await card(page, 0)
    .getByLabel(/Incluir/)
    .check();
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(card(page, 0)).toContainText('Actividad creada');
  expect(await activities(page)).toHaveLength(1);
});

test('a message with nothing academic gives no proposals and ways forward', async ({ page }) => {
  await newUser(page, ['Redes']);
  await interpret(page, 'Buenas tardes estudiantes, espero que estén bien.');
  await expect(page.getByText('No encontramos actividades claras en este mensaje.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crear actividad manualmente' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usar Captura rápida' })).toBeVisible();
  expect(await activities(page)).toHaveLength(0);
});

test('empty and too-long messages are explained and keep the text', async ({ page }) => {
  await newUser(page, ['Redes']);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('alert')).toHaveText('Pega un mensaje para continuar.');
  await expect(page.getByRole('alert')).toBeFocused();
  await textbox(page).fill('x '.repeat(2600));
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('alert')).toContainText('El texto es demasiado largo.');
  await expect(textbox(page)).not.toHaveValue('');
});

test('a duplicate only warns, and can still be created explicitly', async ({ page }) => {
  await newUser(page, ['Redes']);
  const message = `El ${name1} tendremos parcial de Redes.`;
  await interpret(page, message);
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(card(page, 0)).toContainText('Actividad creada');

  await interpret(page, message);
  await expect(card(page, 0)).toContainText('Ya existe una actividad similar.');
  await expect(card(page, 0).getByLabel(/Incluir/)).not.toBeChecked();
  await card(page, 0)
    .getByLabel(/Incluir/)
    .check();
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(card(page, 0)).toContainText('Actividad creada');
  expect(await activities(page)).toHaveLength(2);
});
