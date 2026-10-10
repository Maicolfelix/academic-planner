import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
  login,
  openActivityMenu,
} from './helpers';

async function newUserWithSubject(page: Page, subjectName = 'Redes') {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page);
  await addSubjectViaUi(page, subjectName);
  return email;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

test('activity flow: create, edit, status, persistence, subject guard, delete, empty states', async ({
  page,
}) => {
  const assertClean = watch(page, ['409 /api/subjects/*']);
  const email = uniqueEmail();

  // Setup: new user, current period, subject "Redes".
  await register(page, email);
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');

  // Empty state on /activities.
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('heading', { name: 'Actividades' })).toBeVisible();
  await expect(page.getByText('Aún no tienes actividades.')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // 4-5. Create "Parcial 1" with the quick form (title, subject, date) plus type from "Más opciones".
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog.getByLabel('Título')).toBeFocused();
  await expect(dialog.getByLabel('Asignatura')).toHaveValue(/.+/); // single subject: preselected
  await expect(dialog.getByLabel('Estado')).toHaveCount(0); // never asked on creation
  await dialog.getByLabel('Título').fill('Parcial 1');
  await dialog.getByLabel('Fecha').fill(daysFromNow(7));
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Tipo').selectOption({ label: 'Parcial' });
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();

  // 6. Listed with subject, due date and discreet text badges (status Pendiente, priority Media).
  const parcial = card(page, 'Parcial 1');
  await expect(page.getByRole('status').filter({ hasText: 'Actividad creada.' })).toBeVisible();
  await expect(parcial).toBeVisible();
  await expect(parcial).toContainText('Redes');
  await expect(parcial).toContainText('Pendiente');
  await expect(parcial).toContainText('Media');
  await expect(parcial).toContainText('Parcial');
  await expect(parcial).not.toContainText('Vencida');
  await expect(page.getByText('Aún no tienes actividades.')).toBeHidden();

  // 7. Edit priority to Alta.
  await page.getByRole('button', { name: 'Editar Parcial 1', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(edit.getByLabel('Título')).toHaveValue('Parcial 1');
  await expect(edit.getByLabel('Prioridad')).toBeVisible(); // "Más opciones" opens by itself (type is not default)
  await edit.getByLabel('Prioridad').selectOption({ label: 'Alta' });
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toBeHidden();
  await expect(parcial).toContainText('Alta');
  await expect(parcial).not.toContainText('Media');

  // 8. Change status to En proceso from the card.
  await parcial.getByLabel('Cambiar estado de Parcial 1').selectOption({ label: 'En proceso' });
  // Wait for the real effect: the select is controlled, so it only shows the new value once the server answered.
  // (toContainText('En proceso') is always true: it is also the text of an <option>. Reloading right away aborted
  // the in-flight PATCH and the status was lost: the long-standing flake of this test.)
  await expect(parcial.getByLabel('Cambiar estado de Parcial 1')).toHaveValue('IN_PROGRESS');

  // 9-10. Refresh: persisted.
  await page.reload();
  await expect(parcial).toContainText('Alta');
  await expect(parcial).toContainText('En proceso');
  await expect(parcial.getByLabel('Cambiar estado de Parcial 1')).toHaveValue('IN_PROGRESS');

  // 11-12. Mark Finalizada: visible in text and in the title treatment (not color alone).
  await parcial.getByLabel('Cambiar estado de Parcial 1').selectOption({ label: 'Finalizada' });
  await expect(parcial).toContainText('Finalizada');
  await expect(parcial.getByRole('heading', { name: 'Parcial 1' })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  );

  // 13-14. Reopen.
  await parcial.getByLabel('Cambiar estado de Parcial 1').selectOption({ label: 'Pendiente' });
  await expect(parcial).toContainText('Pendiente');
  await expect(parcial.getByRole('heading', { name: 'Parcial 1' })).not.toHaveCSS(
    'text-decoration-line',
    'line-through',
  );
  await page.reload();
  await expect(parcial).toContainText('Pendiente');

  // 15-16. A subject that still has activities cannot be deleted: clear message, nothing lost.
  await nav(page).getByRole('link', { name: 'Asignaturas' }).click();
  await page.getByRole('button', { name: 'Eliminar Redes' }).click();
  const confirmSubject = page.getByRole('dialog', { name: '¿Eliminar Redes?' });
  await confirmSubject.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(confirmSubject.getByRole('alert')).toHaveText(
    'La asignatura tiene actividades o bloques de agenda asociados.',
  );
  await confirmSubject.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Redes' })).toBeVisible();

  // 17. Delete the activity (with confirmation).
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await openActivityMenu(page, 'Parcial 1');
  await page.getByRole('menuitem', { name: 'Eliminar Parcial 1' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Parcial 1?' });
  await expect(confirm.getByText('Esta acción eliminará la actividad.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Aún no tienes actividades.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Actividad eliminada.' })).toBeVisible();

  // 18-19. Now the subject can go, and every list is back to its empty state.
  await nav(page).getByRole('link', { name: 'Asignaturas' }).click();
  await page.getByRole('button', { name: 'Eliminar Redes' }).click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Redes?' })
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await expect(page.getByText('Aún no tienes asignaturas.')).toBeVisible();
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  // F1-1: having no subject no longer blocks the screen; activities can still be added (as "Sin asignatura").
  await expect(page.getByText('Primero agrega una asignatura.')).toHaveCount(0);
  await expect(page.getByText('Aún no tienes actividades.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar actividad' })).toBeVisible();

  // The session and data survive a full logout/login cycle. Let the screen finish loading first: logging out with
  // the activities request still in flight is answered 401 by the server (seen under 4 parallel browsers).
  await page.waitForLoadState('networkidle');
  await page.getByRole('banner').getByRole('button', { name: 'Cerrar sesión' }).click();
  await login(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);

  assertClean();
});

test('overdue is derived: shown as "Vencida", status untouched, gone once finished', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  const [subject] = await apiSubjects(page);
  await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: 'Entrega vieja',
    dueDate: '2020-01-15',
  });
  await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: 'Entrega futura',
    dueDate: '2099-01-15',
  });

  await page.goto('/activities');
  const old = card(page, 'Entrega vieja');
  await expect(old).toContainText('Vencida');
  await expect(old).toContainText('Pendiente'); // the status itself did not change
  await expect(card(page, 'Entrega futura')).not.toContainText('Vencida');

  // "Vencidas" filter: only the overdue one, reflected in the URL.
  await page.getByRole('button', { name: 'Vencidas' }).click();
  await expect(page).toHaveURL(/overdue=true/);
  await expect(page.getByRole('button', { name: 'Vencidas' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(old).toBeVisible();

  // Finishing it removes "Vencida" and takes it out of the Vencidas view.
  await old.getByLabel('Cambiar estado de Entrega vieja').selectOption({ label: 'Finalizada' });
  await expect(page.getByText('No hay actividades que coincidan con los filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await expect(card(page, 'Entrega vieja')).toContainText('Finalizada');
  await expect(card(page, 'Entrega vieja')).not.toContainText('Vencida');
  // Finished activities are listed after the open ones.
  await expect(page.getByRole('listitem').first()).toContainText('Entrega futura');

  assertClean();
});

test('filters live in the URL, combine, survive reload and can be cleared', async ({ page }) => {
  const assertClean = watch(page);
  await newUserWithSubject(page, 'Redes');
  const bases = await apiCreateSubject(page, 'Bases de Datos');
  const [redes] = (await apiSubjects(page)).filter((s) => s.name === 'Redes');
  const make = (title: string, subjectId: string, extra: object) =>
    apiCreateActivity(page, { subjectId, title, dueDate: '2099-05-20', ...extra });
  await make('R-alta-tarea', redes!.id, { priority: 'HIGH', type: 'TASK' });
  await make('R-baja-quiz', redes!.id, { priority: 'LOW', type: 'QUIZ' });
  const done = await make('B-media-parcial', bases.id, { priority: 'MEDIUM', type: 'EXAM' });
  await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } });

  await page.goto('/activities');
  await expect(page.getByRole('listitem')).toHaveCount(3);

  // Chips.
  await page.getByRole('button', { name: 'Finalizadas' }).click();
  await expect(page).toHaveURL(/status=COMPLETED/);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(card(page, 'B-media-parcial')).toBeVisible();
  await page.getByRole('button', { name: 'Pendientes' }).click();
  await expect(page).toHaveURL(/status=PENDING/);
  await expect(page.getByRole('listitem')).toHaveCount(2);

  // Selectors combine with the chip (Asignatura, Prioridad, Tipo). On a phone they sit under "Más filtros".
  const more = page.getByText(/^Más filtros/);
  if (await more.isVisible()) await more.click();
  await page.getByLabel('Asignatura').selectOption({ label: 'Redes' });
  await page.getByLabel('Prioridad').selectOption({ label: 'Alta' });
  await expect(page).toHaveURL(/priority=HIGH/);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(card(page, 'R-alta-tarea')).toBeVisible();

  // Reload keeps every control exactly as it was.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pendientes' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Prioridad')).toHaveValue('HIGH');
  await expect(page.getByLabel('Asignatura')).toHaveValue(redes!.id);
  await expect(page.getByRole('listitem')).toHaveCount(1);

  // No match: clear message and a way out; then everything cleared.
  await page.getByLabel('Tipo').selectOption({ label: 'Parcial' });
  await expect(page.getByText('No hay actividades que coincidan con los filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).first().click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('listitem')).toHaveCount(3);

  // A shared link opens the same filtered view; tampered values are ignored.
  await page.goto('/activities?status=COMPLETED&type=EXAM');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.goto('/activities?status=HACKED&priority=DROP');
  await expect(page.getByRole('listitem')).toHaveCount(3);

  assertClean();
});

test('the due time is shown and edited in the user’s timezone, whatever the browser’s', async ({
  browser,
}) => {
  // The browser believes it is in Tokyo (UTC+9); the user lives in Bogotá (UTC-5).
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await page.goto('/activities');

  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill('Con hora');
  await dialog.getByLabel('Fecha').fill('2099-10-10');
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Hora (opcional)').fill('14:00');
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const second = page.getByRole('dialog', { name: 'Agregar actividad' });
  await second.getByLabel('Título').fill('Sin hora');
  await second.getByLabel('Fecha').fill('2099-10-10');
  await second.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(second).toBeHidden();

  // 14:00 Bogotá is 19:00 UTC and 04:00 (next day) in Tokyo: the card must still say 2:00 PM on the 10th.
  await expect(card(page, 'Con hora')).toContainText('10');
  await expect(card(page, 'Con hora')).toContainText(/2:00/);
  await expect(card(page, 'Sin hora')).toContainText('10');
  await expect(card(page, 'Sin hora')).not.toContainText(':');

  // Editing shows the same wall-clock values back.
  await page.getByRole('button', { name: 'Editar Con hora' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(edit.getByLabel('Fecha')).toHaveValue('2099-10-10');
  await expect(edit.getByLabel('Hora (opcional)')).toHaveValue('14:00');
  await edit.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Editar Sin hora' }).click();
  const editAllDay = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(editAllDay.getByLabel('Fecha')).toHaveValue('2099-10-10');
  await expect(editAllDay.getByLabel('Hora (opcional)')).toHaveValue('');

  assertClean();
  await context.close();
});

test('activity form: validation, keyboard, focus and responsive layout with long content', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page, 'Redes');
  await apiCreateSubject(page, 'Bases de Datos');
  const [redes] = (await apiSubjects(page)).filter((s) => s.name === 'Redes');

  // A long list with a very long title (spaces and an unbroken word) must wrap, never overflow.
  const longTitle =
    `Proyecto ${'x'.repeat(60)} integrador de ingeniería de software ${'palabra '.repeat(10)}`
      .trim()
      .slice(0, 150);
  await apiCreateActivity(page, {
    subjectId: redes!.id,
    title: longTitle,
    dueDate: '2099-03-01',
    description: 'd '.repeat(300),
  });
  for (let i = 1; i <= 14; i++) {
    await apiCreateActivity(page, {
      subjectId: redes!.id,
      title: `Actividad número ${i}`,
      dueDate: `2099-04-${String(i).padStart(2, '0')}`,
      priority: i % 3 === 0 ? 'HIGH' : 'MEDIUM',
    });
  }

  await page.goto('/activities');
  await expect(page.getByRole('listitem')).toHaveCount(15);
  await expectNoHorizontalOverflow(page); // long list + long title + filters visible

  // Open the form: with two subjects none is preselected; an empty submit explains every problem.
  const addButton = page.getByRole('button', { name: 'Agregar actividad' });
  await addButton.click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog.getByLabel('Título')).toBeFocused();
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog.getByText('Ingresa un título.')).toBeVisible();
  await expect(dialog.getByText('Elige una asignatura.')).toBeVisible();
  await expect(dialog.getByText('Ingresa una fecha válida.')).toBeVisible();
  await expect(dialog.getByLabel('Título')).toHaveAttribute('aria-invalid', 'true');

  // Advanced options open: still inside the viewport and without sideways scroll.
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Descripción').fill('texto '.repeat(80));
  await expectNoHorizontalOverflow(page);
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);

  // The student has typed: Escape asks before throwing it away ("Seguir editando" is the safe, focused answer)...
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('alert')).toContainText('Tienes cambios sin guardar');
  await expect(dialog.getByRole('button', { name: 'Seguir editando' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Descripción')).toHaveValue(/texto texto/);
  // ...and discarding closes it, with focus back on the trigger.
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Descartar cambios' }).click();
  await expect(dialog).toBeHidden();
  await expect(addButton).toBeFocused();

  // Edit and delete dialogs of the long-titled activity also fit.
  await page.getByRole('button', { name: new RegExp(`^Editar Proyecto x`) }).click();
  const edit = page.getByRole('dialog', { name: 'Editar actividad' });
  await expectNoHorizontalOverflow(page);
  const editBox = (await edit.boundingBox())!;
  expect(editBox.x + editBox.width).toBeLessThanOrEqual(viewport.width);
  await page.keyboard.press('Escape');
  await openActivityMenu(page, /Proyecto x/);
  await page.getByRole('menuitem', { name: /^Eliminar Proyecto x/ }).click();
  const confirm = page.getByRole('dialog', { name: /^¿Eliminar Proyecto x/ });
  await expectNoHorizontalOverflow(page);
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listitem')).toHaveCount(15);

  // Status chips are real buttons reachable with the keyboard.
  await page.getByRole('button', { name: 'Pendientes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/status=PENDING/);

  assertClean();
});

test('a second user sees none of the first user’s activities and cannot open them', async ({
  page,
  browser,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  const [subject] = await apiSubjects(page);
  const secret = await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: 'Privada de A',
    dueDate: '2099-01-01',
  });

  const second = await browser.newContext({ ...test.info().project.use });
  const other = await second.newPage();
  const assertOtherClean = watch(other, ['404 /api/activities/*']);
  await register(other, uniqueEmail(), 'Otra Persona');
  await completeOnboarding(other);
  await addSubjectViaUi(other, 'Materia de B');
  await other.goto('/activities');
  await expect(other.getByText('Aún no tienes actividades.')).toBeVisible();
  await expect(other.getByText('Privada de A')).toHaveCount(0);

  // Directly through the API with B's session: the list is empty and A's activity does not exist for B.
  expect((await (await other.request.get('/api/activities')).json()).activities).toEqual([]);
  const peek = await other.request.get(`/api/activities/${secret.id}`);
  const ghost = await other.request.get('/api/activities/0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11');
  expect(peek.status()).toBe(404);
  expect(await peek.json()).toEqual(await ghost.json());

  await second.close();
  assertClean();
  assertOtherClean();
});
