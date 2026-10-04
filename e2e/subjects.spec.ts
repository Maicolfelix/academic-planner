import { expect, test, type Page } from '@playwright/test';
import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  login,
  NAME,
  register,
  uniqueEmail,
  watch,
} from './helpers';

async function newUserWithPeriod(page: Page) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page);
  return email;
}

async function addSubject(
  page: Page,
  name: string,
  extra: { color?: string; professor?: string } = {},
) {
  await page.getByRole('button', { name: 'Agregar asignatura' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await dialog.getByLabel('Nombre').fill(name);
  if (extra.color) await dialog.getByLabel(extra.color).check({ force: true });
  if (extra.professor) {
    await dialog.getByText('Más opciones').click();
    await dialog.getByLabel('Profesor').fill(extra.professor);
  }
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const card = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
const swatchColor = (page: Page, name: string) =>
  card(page, name).locator('span[aria-hidden="true"]').first();

test('academic flow: onboarding, create, edit, color, persistence, delete, logout/login', async ({
  page,
}) => {
  const assertClean = watch(page);
  const email = uniqueEmail();

  // 1-2. New user -> onboarding (3 fields) -> subjects.
  await register(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: 'Configuremos tu semestre' })).toBeVisible();
  await completeOnboarding(page);

  // Empty state: guidance and a single call to action, no empty table.
  await expect(page.getByRole('heading', { name: 'Mis asignaturas' })).toBeVisible();
  await expect(page.getByText('Aún no tienes asignaturas.')).toBeVisible();
  await expect(
    page.getByText(
      'Agrega las materias de este semestre para comenzar a organizar tus actividades.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('03/08/2026 – 28/11/2026')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 3-5. Add two subjects.
  await addSubject(page, 'Redes', { professor: 'Carlos Pérez' });
  await expect(page.getByRole('status').filter({ hasText: 'Asignatura creada.' })).toBeVisible();
  await addSubject(page, 'Bases de Datos');
  await expect(card(page, 'Redes')).toBeVisible();
  await expect(card(page, 'Redes')).toContainText('Profesor: Carlos Pérez');
  await expect(card(page, 'Bases de Datos')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Aún no tienes asignaturas.')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  // 6-7. Edit Redes: rename and change color.
  await expect(swatchColor(page, 'Redes')).toHaveCSS('background-color', 'rgb(59, 130, 246)'); // default blue
  await page.getByRole('button', { name: 'Editar Redes', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar asignatura' });
  await expect(edit.getByLabel('Nombre')).toHaveValue('Redes');
  await expect(edit.getByLabel('Profesor')).toHaveValue('Carlos Pérez'); // disclosure opens when filled
  await edit.getByLabel('Nombre').fill('Redes y Comunicaciones');
  await edit.getByLabel('Rojo').check({ force: true });
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toBeHidden();

  // The list updates without any reload.
  await expect(card(page, 'Redes y Comunicaciones')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Asignatura actualizada.' }),
  ).toBeVisible();
  await expect(swatchColor(page, 'Redes y Comunicaciones')).toHaveCSS(
    'background-color',
    'rgb(239, 68, 68)',
  );

  // 8-9. Refresh: persisted.
  await page.reload();
  await expect(card(page, 'Redes y Comunicaciones')).toBeVisible();
  await expect(card(page, 'Redes y Comunicaciones')).toContainText('Profesor: Carlos Pérez');
  await expect(swatchColor(page, 'Redes y Comunicaciones')).toHaveCSS(
    'background-color',
    'rgb(239, 68, 68)',
  );
  await expect(card(page, 'Bases de Datos')).toBeVisible();

  // 10-11. Delete with confirmation.
  await page.getByRole('button', { name: 'Eliminar Bases de Datos' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Bases de Datos?' });
  await expect(confirm.getByText('Esta acción eliminará la asignatura.')).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused(); // safe default
  await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(card(page, 'Bases de Datos')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Asignatura eliminada.' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);

  // 12-14. Logout, login again: data is still there.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Asignaturas' }).first().click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(card(page, 'Redes y Comunicaciones')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  assertClean();
});

test('a second, brand new user sees none of the first user’s subjects', async ({
  page,
  browser,
}) => {
  const assertClean = watch(page);
  await newUserWithPeriod(page);
  await addSubject(page, 'Materia privada');
  await expect(card(page, 'Materia privada')).toBeVisible();

  const second = await browser.newContext({ ...test.info().project.use });
  const other = await second.newPage();
  const assertOtherClean = watch(other);
  await register(other, uniqueEmail(), 'Otra Persona');
  await completeOnboarding(other);
  await expect(other.getByText('Aún no tienes asignaturas.')).toBeVisible();
  await expect(other.getByRole('listitem')).toHaveCount(0);
  await expect(other.getByText('Materia privada')).toHaveCount(0);

  // Directly through the API with the second user's session: still nothing.
  const res = await other.request.get('/api/subjects');
  expect((await res.json()).subjects).toEqual([]);

  await second.close();
  assertClean();
  assertOtherClean();
});

test('onboarding validates dates and requires a period before using the app', async ({ page }) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);

  // Protected pages redirect to onboarding while there is no period.
  await page.goto('/subjects');
  await expect(page).toHaveURL(/\/onboarding$/);

  // Empty dates.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Ingresa una fecha válida.').first()).toBeVisible();

  // End before start.
  await page.getByLabel('Inicio', { exact: true }).fill('2026-11-28');
  await page.getByLabel('Fin', { exact: true }).fill('2026-08-03');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('La fecha de fin debe ser posterior a la de inicio.')).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);

  // Fix it and continue; onboarding is not reachable again afterwards.
  await page.getByLabel('Inicio', { exact: true }).fill('2026-08-03');
  await page.getByLabel('Fin', { exact: true }).fill('2026-11-28');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/subjects$/);

  assertClean();
});

test('subject form: validation, duplicates, cancel, keyboard and responsive layout', async ({
  page,
}) => {
  const assertClean = watch(page, ['409 /api/subjects']);
  await newUserWithPeriod(page);

  const addButton = page.getByRole('button', { name: 'Agregar asignatura' });
  await addButton.click();
  const dialog = page.getByRole('dialog', { name: 'Agregar asignatura' });

  // Name is focused first; empty submit shows a clear error and sends nothing.
  await expect(dialog.getByLabel('Nombre')).toBeFocused();
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog.getByText('Ingresa un nombre.')).toBeVisible();
  await expect(dialog.getByLabel('Nombre')).toHaveAttribute('aria-invalid', 'true');

  // Color is a labelled radio group reachable by keyboard; a long name must wrap, never overflow.
  await dialog
    .getByLabel('Nombre')
    .fill('Electiva profesional en ingeniería de software y sistemas distribuidos avanzados');
  await dialog.getByLabel('Azul').focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByLabel('Rojo')).toBeChecked();
  await expectNoHorizontalOverflow(page); // with the dialog open
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);

  // Escape closes and returns focus to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(addButton).toBeFocused();

  // Create "Redes", then a duplicate in other casing/spacing is refused with a clear message.
  await addSubject(page, 'Redes');
  await page.getByRole('button', { name: 'Agregar asignatura' }).click();
  const second = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await second.getByLabel('Nombre').fill('  rEDES ');
  await second.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(
    second.getByText('Ya tienes una asignatura con ese nombre en este periodo.'),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Cancelar' }).click();
  await expect(second).toBeHidden();
  await expect(page.getByRole('listitem')).toHaveCount(1);

  // Cancelling a delete keeps the subject.
  await page.getByRole('button', { name: 'Eliminar Redes' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Redes?' });
  await expectNoHorizontalOverflow(page);
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(confirm).toBeHidden();
  await expect(card(page, 'Redes')).toBeVisible();

  assertClean();
});

test('navigation: shell links work and the user name is shown', async ({ page }) => {
  const assertClean = watch(page);
  await newUserWithPeriod(page);

  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Asignaturas' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await nav.getByRole('link', { name: 'Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: `Hola, ${NAME}` })).toBeVisible();
  await expect(page.getByText('Periodo actual:')).toContainText('Segundo semestre 2026');
  await expect(nav.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  assertClean();
});
