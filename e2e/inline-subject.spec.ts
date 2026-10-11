import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  entrancesDone,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * F1-2a: "Crear asignatura" inline in the activity form. Nothing is created until the student asks, nothing typed in the
 * activity is lost, Enter in the name creates the subject (never saves the activity) and cancelling leaves no trace.
 */

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

async function newUser(page: Page, subjects: string[] = []) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  for (const name of subjects) await addSubjectViaUi(page, name);
}

async function openAdd(page: Page) {
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await expect(page.getByRole('heading', { name: 'Actividades', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog.getByLabel('Título')).toBeFocused();
  return dialog;
}

const select = (dialog: Locator) => dialog.getByRole('combobox', { name: 'Asignatura' });
const creator = (dialog: Locator) => dialog.getByRole('group', { name: 'Nueva asignatura' });
const createButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Crear asignatura' });
const apiActivities = async (page: Page) =>
  (await (await page.request.get('/api/activities')).json()).activities as {
    id: string;
    title: string;
    subjectId: string | null;
    type: string;
    priority: string;
    description: string | null;
    hasTime: boolean;
  }[];

/** Fills what a student may already have written when they realise the subject does not exist yet. */
async function writeActivity(dialog: Locator, title: string) {
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Fecha').fill(daysFromNow(9));
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Hora (opcional)').fill('14:30');
  await dialog.getByLabel('Tipo').selectOption({ label: 'Parcial' });
  await dialog.getByLabel('Prioridad').selectOption({ label: 'Alta' });
  await dialog.getByLabel('Descripción').fill('Capítulos 1 a 4 y el laboratorio');
}

async function expectActivityIntact(dialog: Locator, title: string) {
  await expect(dialog.getByLabel('Título')).toHaveValue(title);
  await expect(dialog.getByLabel('Fecha')).toHaveValue(daysFromNow(9));
  await expect(dialog.getByLabel('Hora (opcional)')).toHaveValue('14:30');
  await expect(dialog.getByLabel('Tipo')).toHaveValue('EXAM');
  await expect(dialog.getByLabel('Prioridad')).toHaveValue('HIGH');
  await expect(dialog.getByLabel('Descripción')).toHaveValue('Capítulos 1 a 4 y el laboratorio');
}

test('create a subject from a half-written activity: nothing is lost, the subject is selected and used', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await writeActivity(dialog, 'Parcial de Ciberseguridad');

  // Opening the creator creates nothing and keeps the form where it was.
  await createButton(dialog).click();
  await expect(creator(dialog)).toBeVisible();
  await expect(creator(dialog).getByLabel('Nombre')).toBeFocused();
  expect(await apiSubjects(page)).toHaveLength(1);

  await creator(dialog).getByLabel('Nombre').fill('  Ciberseguridad ');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();

  // Back in the form: the creator is gone, the new subject is the selected one and the focus is on the selector.
  await expect(creator(dialog)).toHaveCount(0);
  const subjects = await apiSubjects(page);
  expect(subjects.map((s) => s.name).sort()).toEqual(['Ciberseguridad', 'Redes']);
  const created = subjects.find((s) => s.name === 'Ciberseguridad')!;
  await expect(select(dialog)).toHaveValue(created.id);
  await expect(select(dialog)).toBeFocused();
  await expectActivityIntact(dialog, 'Parcial de Ciberseguridad');

  // Saving the activity uses the subject that was just created.
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    card(page, 'Parcial de Ciberseguridad').getByText('Ciberseguridad', { exact: true }),
  ).toBeVisible();
  const [saved] = await apiActivities(page);
  expect(saved).toMatchObject({
    title: 'Parcial de Ciberseguridad',
    subjectId: created.id,
    type: 'EXAM',
    priority: 'HIGH',
    description: 'Capítulos 1 a 4 y el laboratorio',
    hasTime: true,
  });
  assertClean();
});

test('cancelling the creator returns to the exact previous state and creates nothing', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases']);
  const dialog = await openAdd(page);
  await writeActivity(dialog, 'Taller de redes');
  const redes = (await apiSubjects(page)).find((s) => s.name === 'Redes')!;
  await select(dialog).selectOption(redes.id);

  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('No debe existir');
  await creator(dialog).getByRole('button', { name: 'Cancelar' }).click();

  await expect(creator(dialog)).toHaveCount(0);
  await expect(createButton(dialog)).toBeFocused(); // the focus returns to where it was
  await expect(select(dialog)).toHaveValue(redes.id); // the previous choice, untouched
  await expectActivityIntact(dialog, 'Taller de redes');
  expect((await apiSubjects(page)).map((s) => s.name).sort()).toEqual(['Bases', 'Redes']);

  // Opening it again starts clean.
  await createButton(dialog).click();
  await expect(creator(dialog).getByLabel('Nombre')).toHaveValue('');
  assertClean();
});

test('Enter in the name creates the subject and does NOT save the activity', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await writeActivity(dialog, 'Quiz de Ciberseguridad');
  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('Ciberseguridad');
  await page.keyboard.press('Enter');

  await expect(creator(dialog)).toHaveCount(0);
  await expect(dialog).toBeVisible(); // still the form: the activity was not submitted
  const created = (await apiSubjects(page)).find((s) => s.name === 'Ciberseguridad')!;
  await expect(select(dialog)).toHaveValue(created.id);
  await expectActivityIntact(dialog, 'Quiz de Ciberseguridad');
  expect(await apiActivities(page)).toHaveLength(0);

  // The activity is saved only by its own button.
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await apiActivities(page))[0]).toMatchObject({ subjectId: created.id });
  assertClean();
});

test('a name the student already has selects that subject instead of duplicating it', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores', 'Bases']);
  const dialog = await openAdd(page);
  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('  redes DE computadores ');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();

  const subjects = await apiSubjects(page);
  expect(subjects).toHaveLength(2); // no duplicate
  const redes = subjects.find((s) => s.name === 'Redes de Computadores')!;
  await expect(select(dialog)).toHaveValue(redes.id);
  await expect(dialog.getByRole('status')).toContainText('Ya tenías «Redes de Computadores»');
  assertClean();
});

test('a name that is only taken on the server says so, and asking again selects it (the id is never guessed)', async ({
  page,
}) => {
  const assertClean = watch(page, ['409 /api/subjects']);
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await createButton(dialog).click();

  // Another tab creates "Bases" while this list does not know it yet.
  const bases = await apiCreateSubject(page, 'Bases');
  const input = creator(dialog).getByLabel('Nombre');
  await input.fill('Bases');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(
    creator(dialog).getByText('Ya tienes una asignatura con ese nombre en este periodo.'),
  ).toBeVisible();
  expect((await apiSubjects(page)).filter((s) => s.name === 'Bases')).toHaveLength(1);

  // The list refreshes by itself, so the same name now selects the existing subject.
  await expect(async () => {
    await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();
    await expect(creator(dialog)).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(select(dialog)).toHaveValue(bases.id);
  assertClean();
});

test('an empty or invalid name is said in words on the field, and nothing is sent', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await createButton(dialog).click();
  const input = creator(dialog).getByLabel('Nombre');

  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await input.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toBeVisible();
  await expect(page.locator(`#${describedBy}`)).not.toBeEmpty();

  await input.fill('Algo');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true'); // typing clears it
  expect((await apiSubjects(page)).map((s) => s.name)).toEqual(['Redes']);
  assertClean();
});

test('with NO subjects the form opens as "Sin asignatura" and creating one is the way forward', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page); // a period and zero subjects
  const dialog = await openAdd(page);
  await expect(
    dialog.getByRole('group', { name: 'Asignatura' }).getByText('Sin asignatura'),
  ).toBeVisible();
  await expect(createButton(dialog)).toBeVisible();
  await dialog.getByLabel('Título').fill('Tarea de la nueva materia');
  await dialog.getByLabel('Fecha').fill(daysFromNow(4));

  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('Ciberseguridad');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();

  await expect(creator(dialog)).toHaveCount(0); // done: the subject exists
  const [created] = await apiSubjects(page);
  expect(created!.name).toBe('Ciberseguridad');
  await expect(select(dialog)).toHaveValue(created!.id); // the selector exists now, with the new subject chosen
  await expect(dialog.getByLabel('Título')).toHaveValue('Tarea de la nueva materia');
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await apiActivities(page))[0]).toMatchObject({ subjectId: created!.id });
  assertClean();
});

test('it coexists with "Omitir asignatura": omit, restore, create and omit again, each keeping what was written', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await writeActivity(dialog, 'Reunión de semillero');

  // Create from the normal state, then omit and restore: the created subject is still the chosen one.
  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('Semillero');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();
  await expect(creator(dialog)).toHaveCount(0); // done: the subject exists
  const semillero = (await apiSubjects(page)).find((s) => s.name === 'Semillero')!;
  await expect(select(dialog)).toHaveValue(semillero.id);
  await dialog.getByRole('button', { name: 'Omitir asignatura' }).click();
  await expect(
    dialog.getByRole('group', { name: 'Asignatura' }).getByText('Sin asignatura'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Elegir asignatura' }).click();
  await expect(select(dialog)).toHaveValue(semillero.id);

  // From "Sin asignatura" it can be created too (and cancelled back to that state).
  await dialog.getByRole('button', { name: 'Omitir asignatura' }).click();
  await createButton(dialog).click();
  await creator(dialog).getByRole('button', { name: 'Cancelar' }).click();
  await expect(
    dialog.getByRole('group', { name: 'Asignatura' }).getByText('Sin asignatura'),
  ).toBeVisible();
  await expect(createButton(dialog)).toBeFocused();
  await expectActivityIntact(dialog, 'Reunión de semillero');

  // Omitted at the end: the activity is general (the created subject exists but is not used).
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await apiActivities(page))[0]).toMatchObject({
    title: 'Reunión de semillero',
    subjectId: null,
  });
  assertClean();
});

test('editing: the reminders and every field survive creating a subject, and the activity moves to it', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const redes = (await apiSubjects(page))[0]!;
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Parcial editable',
    dueDate: daysFromNow(12),
    type: 'EXAM',
  });
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await page.getByRole('button', { name: 'Editar Parcial editable', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  const reminders = dialog.getByRole('region', { name: 'Recordatorios' });
  await expect(reminders).toBeVisible();
  const remindersBefore = await reminders.getByRole('listitem').count();
  await dialog.getByLabel('Título').fill('Parcial editable (nuevo título)');

  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('Ciberseguridad');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();
  await expect(creator(dialog)).toHaveCount(0); // done: the subject exists

  const created = (await apiSubjects(page)).find((s) => s.name === 'Ciberseguridad')!;
  await expect(select(dialog)).toHaveValue(created.id);
  await expect(dialog.getByLabel('Título')).toHaveValue('Parcial editable (nuevo título)');
  await expect(reminders).toBeVisible();
  await expect(reminders.getByRole('listitem')).toHaveCount(remindersBefore);

  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
  expect((await apiActivities(page))[0]).toMatchObject({
    title: 'Parcial editable (nuevo título)',
    subjectId: created.id,
  });
  assertClean();
});

test('keyboard and accessibility: focus goes to the name, Tab stays inside, buttons are 44 px, axe is clean, no overflow', async ({
  page,
}) => {
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await createButton(dialog).focus();
  await page.keyboard.press('Enter');
  const input = creator(dialog).getByLabel('Nombre');
  await expect(input).toBeFocused();
  await entrancesDone(page);

  // Natural order: name -> Cancelar -> Crear y usar. No nested form.
  await page.keyboard.press('Tab');
  await expect(creator(dialog).getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(creator(dialog).getByRole('button', { name: 'Crear y usar' })).toBeFocused();
  expect(await dialog.locator('form').count()).toBe(1);
  for (const name of ['Cancelar', 'Crear y usar']) {
    const height = await creator(dialog)
      .getByRole('button', { name })
      .evaluate((el) => (el as HTMLElement).offsetHeight);
    expect(height, name).toBeGreaterThanOrEqual(44);
  }

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await expectNoHorizontalOverflow(page);

  // Cancelling with the keyboard gives the focus back to "Crear asignatura".
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(creator(dialog)).toHaveCount(0);
  await expect(createButton(dialog)).toBeFocused();
});

test('saving while the creator is open asks to finish or cancel it, and saves nothing', async ({
  page,
}) => {
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await dialog.getByLabel('Título').fill('Actividad a medias');
  await dialog.getByLabel('Fecha').fill(daysFromNow(3));
  await createButton(dialog).click();
  await creator(dialog).getByLabel('Nombre').fill('Pendiente');
  // The submit button sits below the creator: press it like a student would.
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'Termina de crear la asignatura' }),
  ).toBeVisible();
  await expect(creator(dialog).getByLabel('Nombre')).toBeFocused();
  expect(await apiActivities(page)).toHaveLength(0);
  expect(await apiSubjects(page)).toHaveLength(1);
});

test('with reduced motion the creator appears at once (no animation left running)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await newUser(page, ['Redes']);
  const dialog = await openAdd(page);
  await createButton(dialog).click();
  await expect(creator(dialog)).toBeVisible();
  const duration = await creator(dialog).evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000)).toBeLessThan(1); // under 1 ms
  await entrancesDone(page);
  await creator(dialog).getByLabel('Nombre').fill('Ciberseguridad');
  await creator(dialog).getByRole('button', { name: 'Crear y usar' }).click();
  await expect(creator(dialog)).toHaveCount(0);
  await expect(select(dialog)).toBeFocused();
});
