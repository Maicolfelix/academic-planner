import { addDays, formatDateOnly, weekdayOf, weekRangeOf } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateSubject,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

// A period that always contains "today" (the system clock decides what today is).
const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const isMobile = (page: Page) => page.viewportSize()!.width < 768;
const thisWeek = () => weekRangeOf(bogotaToday());
const nextWeek = () => weekRangeOf(addDays(thisWeek().from, 7));

async function newUser(page: Page, subjects: string[] = ['Redes']) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  for (const name of subjects) await addSubjectViaUi(page, name);
  await nav(page).getByRole('link', { name: 'Agenda' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
}

/** Phones show one day at a time: pick the day first. Desktop shows the whole week already. */
async function showDay(page: Page, date: string) {
  if (!isMobile(page)) return;
  const weekday = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][
    weekdayOf(date) - 1
  ]!;
  await page
    .getByRole('button', { name: new RegExp(`^${weekday} ${Number(date.slice(8))}\\b`) })
    .click();
}

/** The block, in either layout (a grid button on desktop, a list row on a phone). */
const blockButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(title) });

async function openForm(page: Page) {
  await page.getByRole('button', { name: 'Agregar bloque' }).click();
  return page.getByRole('dialog', { name: 'Agregar bloque' });
}

async function fillClass(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  o: { subject: string; day: string; start: string; end: string },
) {
  await dialog.getByLabel('Asignatura').selectOption({ label: o.subject });
  await dialog.getByLabel('Día').selectOption({ label: o.day });
  await dialog.getByLabel('Inicio', { exact: true }).fill(o.start);
  await dialog.getByLabel('Fin', { exact: true }).fill(o.end);
}

test('agenda flow: weekly class, next week, conflict warning, study session, edit, persistence, delete series', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  await apiCreateSubject(page, 'Bases de Datos');

  // 4-5. Create the weekly class: subject, weekday, hours. The title fills itself in; "Hasta" is the period's end.
  const dialog = await openForm(page);
  await expect(dialog.getByLabel('Tipo')).toHaveValue('CLASS');
  await expect(dialog.getByLabel('Repetir semanalmente')).toBeChecked();
  await fillClass(page, dialog, { subject: 'Redes', day: 'Martes', start: '08:00', end: '10:00' });
  await expect(dialog.getByLabel('Título')).toHaveValue('Redes'); // no need to type it twice
  await expect(dialog.getByLabel('Hasta')).toHaveValue(period().end);
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Bloque creado.' })).toBeVisible();

  // 6-7. Go to NEXT week: the class is there, on Tuesday, 08:00–10:00 (a single stored rule, expanded for this week).
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(new RegExp(`week=${nextWeek().from}`));
  await expect(page.getByText(`Semana del ${formatDateOnly(nextWeek().from)}`)).toBeVisible();
  await showDay(page, addDays(nextWeek().from, 1));
  await expect(blockButton(page, 'Redes')).toBeVisible();
  await expect(blockButton(page, 'Redes')).toContainText(/08:00/);
  await expect(blockButton(page, 'Redes')).toHaveAccessibleName(/08:00( a |–)10:00/);
  await expect(page.getByRole('button', { name: /choque de horario/i })).toHaveCount(0);

  // 8-10. A second class at 09:00–11:00 the same weekday: the form WARNS first, then lets us save anyway.
  const second = await openForm(page);
  await fillClass(page, second, {
    subject: 'Bases de Datos',
    day: 'Martes',
    start: '09:00',
    end: '11:00',
  });
  await expect(second.getByLabel('Título')).toHaveValue('Bases de Datos');
  await second.getByRole('button', { name: 'Guardar', exact: true }).click();
  const warning = second.getByRole('alert');
  await expect(warning).toContainText('Ya tienes otra actividad programada en este horario.');
  await expect(warning).toContainText('Choca con «Redes»');
  await expect(second).toBeVisible(); // nothing was saved yet
  await second.getByRole('button', { name: 'Guardar de todas formas' }).click();
  await expect(second).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Bloque creado.' })).toBeVisible();

  // The agenda now flags both blocks, with text (not only color).
  await showDay(page, addDays(nextWeek().from, 1));
  await expect(blockButton(page, 'Redes')).toHaveAccessibleName(/choque de horario/i);
  await expect(blockButton(page, 'Bases de Datos')).toHaveAccessibleName(/choque de horario/i);

  // 11. A one-off study session on Wednesday of that week: no clash, so it saves directly.
  const wednesday = addDays(nextWeek().from, 2);
  const study = await openForm(page);
  await study.getByLabel('Tipo').selectOption({ label: 'Estudio' });
  await expect(study.getByLabel('Repetir semanalmente')).not.toBeChecked(); // a study session is a one-off by default
  await study.getByLabel('Título').fill('Repasar redes');
  await study.getByLabel('Fecha').fill(wednesday);
  await study.getByLabel('Inicio', { exact: true }).fill('14:00');
  await study.getByLabel('Fin', { exact: true }).fill('16:00');
  await study.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(study).toBeHidden();
  await showDay(page, wednesday);
  await expect(blockButton(page, 'Repasar redes')).toBeVisible();

  // 12. Edit it.
  await blockButton(page, 'Repasar redes').click();
  const edit = page.getByRole('dialog', { name: 'Editar bloque' });
  await expect(edit.getByLabel('Título')).toHaveValue('Repasar redes');
  await expect(edit.getByLabel('Fecha')).toHaveValue(wednesday);
  await expect(edit.getByLabel('Inicio', { exact: true })).toHaveValue('14:00');
  await edit.getByLabel('Título').fill('Repasar redes (examen)');
  await edit.getByLabel('Fin', { exact: true }).fill('17:00');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Bloque actualizado.' })).toBeVisible();

  // 13-14. Reload: same week (it lives in the URL) and the edit persisted.
  await page.reload();
  await expect(page.getByText(`Semana del ${formatDateOnly(nextWeek().from)}`)).toBeVisible();
  await showDay(page, wednesday);
  await expect(blockButton(page, 'Repasar redes \\(examen\\)')).toBeVisible();
  await expect(blockButton(page, 'Repasar redes \\(examen\\)')).toHaveAccessibleName(
    /14:00( a |–)17:00/,
  );

  // 15-16. The Dashboard reflects the classes of TODAY (when today is a Tuesday that is Redes and Bases).
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  if (weekdayOf(bogotaToday()) === 2) {
    await expect(page.getByRole('region', { name: 'Clases de hoy' })).toContainText('Redes');
  } else {
    await expect(page.getByRole('region', { name: 'Clases de hoy' })).toHaveCount(0);
  }

  // 17. Delete the whole series, after an explicit confirmation.
  await nav(page).getByRole('link', { name: 'Agenda' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await showDay(page, addDays(nextWeek().from, 1));
  await blockButton(page, 'Redes').first().click();
  const editSeries = page.getByRole('dialog', { name: 'Editar bloque' });
  await expect(editSeries.getByText('Este cambio se aplicará a todas las semanas.')).toBeVisible();
  await editSeries.getByRole('button', { name: 'Eliminar' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Redes?' });
  await expect(
    confirm.getByText(
      'Esta clase se repite semanalmente. Se eliminarán todas las apariciones de la agenda.',
    ),
  ).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused(); // safe default
  await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Serie eliminada de la agenda.' }),
  ).toBeVisible();

  // The whole series is gone — next week, this week and the previous one (it was a single rule) —
  // while the other weekly class stays and, no longer clashing with anything, loses its warning.
  await showDay(page, addDays(nextWeek().from, 1));
  await expect(blockButton(page, 'Redes')).toHaveCount(0);
  await expect(blockButton(page, 'Bases de Datos')).toBeVisible();
  await expect(page.getByRole('button', { name: /choque de horario/i })).toHaveCount(0);
  for (const weekStart of [thisWeek().from, addDays(thisWeek().from, -7)]) {
    await page.getByRole('button', { name: 'Anterior' }).click();
    await showDay(page, addDays(weekStart, 1));
    await expect(blockButton(page, 'Redes')).toHaveCount(0);
    await expect(blockButton(page, 'Bases de Datos')).toBeVisible();
  }

  assertClean();
});

test('week navigation: opens on the current week, Anterior / Hoy / Siguiente, and the week lives in the URL', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);

  await expect(
    page.getByText(
      `Semana del ${formatDateOnly(thisWeek().from)} al ${formatDateOnly(thisWeek().to)}`,
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toBeDisabled(); // already on the current week

  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(new RegExp(`week=${nextWeek().from}`));
  await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Anterior' }).click();
  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(
    page.getByText(`Semana del ${formatDateOnly(addDays(thisWeek().from, -7))}`),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByText(`Semana del ${formatDateOnly(thisWeek().from)}`)).toBeVisible();

  // A shared link opens that exact week; anything else falls back to the current one.
  await page.goto(`/calendar?week=${addDays(thisWeek().from, 14)}`);
  await expect(
    page.getByText(`Semana del ${formatDateOnly(addDays(thisWeek().from, 14))}`),
  ).toBeVisible();
  await page.goto('/calendar?week=not-a-date');
  await expect(page.getByText(`Semana del ${formatDateOnly(thisWeek().from)}`)).toBeVisible();

  assertClean();
});

test('form: validation, title auto-fill, single block, and clear messages', async ({ page }) => {
  // Two refusals from the server are the point here (class without subject, date outside the period).
  const assertClean = watch(page, ['400 /api/schedule']);
  await newUser(page, ['Redes', 'Bases de Datos']);

  const dialog = await openForm(page);
  // A class needs a subject.
  await dialog.getByLabel('Título').fill('Algo');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog.getByText('Elige la asignatura de la clase.')).toBeVisible();

  // Title follows the subject until the student writes their own.
  await dialog.getByLabel('Título').fill('');
  await dialog.getByLabel('Asignatura').selectOption({ label: 'Redes' });
  await expect(dialog.getByLabel('Título')).toHaveValue('Redes');
  await dialog.getByLabel('Asignatura').selectOption({ label: 'Bases de Datos' });
  await expect(dialog.getByLabel('Título')).toHaveValue('Bases de Datos');
  await dialog.getByLabel('Título').fill('Mi título');
  await dialog.getByLabel('Asignatura').selectOption({ label: 'Redes' });
  await expect(dialog.getByLabel('Título')).toHaveValue('Mi título'); // not overwritten any more

  // End must be after start.
  await dialog.getByLabel('Inicio', { exact: true }).fill('10:00');
  await dialog.getByLabel('Fin', { exact: true }).fill('08:00');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog.getByText('La hora de fin debe ser posterior a la de inicio.')).toBeVisible();
  await expect(dialog.getByLabel('Fin', { exact: true })).toHaveAttribute('aria-invalid', 'true');

  // Turning repetition off shows a plain date; "Hasta" disappears; a date outside the period is explained.
  await dialog.getByLabel('Repetir semanalmente').uncheck();
  await expect(dialog.getByLabel('Hasta')).toHaveCount(0);
  await dialog.getByLabel('Fecha').fill(bogotaToday(-200));
  await dialog.getByLabel('Fin', { exact: true }).fill('11:00');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog.getByText(/La fecha debe estar dentro del periodo/)).toBeVisible();

  // A valid single block saves (no clash) and shows up.
  await dialog.getByLabel('Fecha').fill(bogotaToday(0));
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto(`/calendar?week=${thisWeek().from}`);
  await showDay(page, bogotaToday(0));
  await expect(blockButton(page, 'Mi título')).toBeVisible();

  assertClean();
});

test('"Revisar horario" keeps the form open so the clash can be fixed instead of saving', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases de Datos']);

  const first = await openForm(page);
  await fillClass(page, first, { subject: 'Redes', day: 'Martes', start: '08:00', end: '10:00' });
  await first.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(first).toBeHidden();

  const second = await openForm(page);
  await fillClass(page, second, {
    subject: 'Bases de Datos',
    day: 'Martes',
    start: '09:00',
    end: '11:00',
  });
  await second.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText(
    'Ya tienes otra actividad programada en este horario.',
  );
  await second.getByRole('button', { name: 'Revisar horario' }).click();
  await expect(second.getByRole('alert')).toHaveCount(0);

  // Moving it to 10:00–12:00 (the first ends at 10:00: touching is not a clash) saves without any warning.
  await second.getByLabel('Inicio', { exact: true }).fill('10:00');
  await second.getByLabel('Fin', { exact: true }).fill('12:00');
  await second.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(second).toBeHidden();
  await showDay(page, bogotaToday(0));
  await expect(page.getByRole('button', { name: /choque de horario/i })).toHaveCount(0);

  assertClean();
});

test('timezone: a class at 08:00 Bogotá reads 08:00 even in a browser set to Tokyo', async ({
  browser,
}) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const assertClean = watch(page);
  await newUser(page);

  // Created through the API at 08:00 (the user's zone is Bogotá); the browser believes it is UTC+9.
  const [subject] = await apiSubjects(page);
  const res = await page.request.post('/api/schedule', {
    data: {
      type: 'CLASS',
      subjectId: subject!.id,
      title: 'Redes',
      date: addDays(thisWeek().from, 1), // Tuesday of this week
      startTime: '08:00',
      endTime: '10:00',
    },
  });
  expect(res.status()).toBe(201);

  await page.reload();
  await showDay(page, addDays(thisWeek().from, 1));
  await expect(blockButton(page, 'Redes')).toHaveAccessibleName(/08:00( a |–)10:00/); // not 22:00
  await expect(page.getByText('22:00')).toHaveCount(0);

  await blockButton(page, 'Redes').click();
  const edit = page.getByRole('dialog', { name: 'Editar bloque' });
  await expect(edit.getByLabel('Inicio', { exact: true })).toHaveValue('08:00');
  await expect(edit.getByLabel('Fin', { exact: true })).toHaveValue('10:00');

  assertClean();
  await context.close();
});

test('Dashboard shows today’s classes only, in the user’s day', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const [subject] = await apiSubjects(page);
  const today = bogotaToday(0);
  const make = async (data: Record<string, unknown>) => {
    const res = await page.request.post('/api/schedule', {
      data: { subjectId: subject!.id, ...data },
    });
    expect(res.status(), await res.text()).toBe(201);
  };
  await make({
    type: 'CLASS',
    title: 'Clase de hoy',
    date: today,
    startTime: '08:00',
    endTime: '10:00',
  });
  await make({
    type: 'STUDY',
    title: 'Estudio de hoy',
    date: today,
    startTime: '14:00',
    endTime: '15:00',
  });
  await make({
    type: 'CLASS',
    title: 'Clase de mañana',
    date: bogotaToday(1),
    startTime: '08:00',
    endTime: '10:00',
  });

  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  const section = page.getByRole('region', { name: 'Clases de hoy' });
  await expect(section).toContainText('Clase de hoy');
  await expect(section).toContainText('08:00–10:00');
  await expect(section).not.toContainText('Estudio de hoy'); // only CLASS
  await expect(section).not.toContainText('Clase de mañana');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  // Deleting a class in the Agenda updates the Dashboard without a reload.
  await nav(page).getByRole('link', { name: 'Agenda' }).click();
  await showDay(page, today);
  await blockButton(page, 'Clase de hoy').click();
  await page
    .getByRole('dialog', { name: 'Editar bloque' })
    .getByRole('button', { name: 'Eliminar' })
    .click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Clase de hoy?' })
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('region', { name: 'Clases de hoy' })).toHaveCount(0);

  assertClean();
});

test('responsive: no horizontal overflow with many blocks, long titles, open dialogs; dialog stays on screen', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const [subject] = await apiSubjects(page);
  const longTitle = `Seminario ${'x'.repeat(50)} de investigación aplicada ${'palabra '.repeat(8)}`
    .trim()
    .slice(0, 100);

  const monday = thisWeek().from;
  const create = async (data: Record<string, unknown>) => {
    const res = await page.request.post('/api/schedule', { data });
    expect(res.status(), await res.text()).toBe(201);
  };
  await create({
    type: 'CLASS',
    subjectId: subject!.id,
    title: longTitle,
    date: monday,
    startTime: '07:00',
    endTime: '09:00',
    recurrence: { frequency: 'WEEKLY', until: period().end },
  });
  for (let i = 0; i < 7; i++) {
    for (const [start, end] of [
      ['08:00', '10:00'],
      ['09:00', '11:00'],
      ['14:00', '15:30'],
      ['19:00', '21:00'],
    ]) {
      await create({
        type: 'STUDY',
        title: `Estudio ${i} ${start}`,
        date: addDays(monday, i),
        startTime: start,
        endTime: end,
      });
    }
  }

  await page.reload();
  await showDay(page, monday);
  await expectNoHorizontalOverflow(page);
  if (!isMobile(page)) {
    // The desktop grid is a real 7-day week.
    for (const day of ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']) {
      await expect(page.getByText(day, { exact: false }).first()).toBeVisible();
    }
  }

  // Dialogs: create (with repetition) and edit both fit and do not widen the page.
  const viewport = page.viewportSize()!;
  const dialog = await openForm(page);
  await expectNoHorizontalOverflow(page);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await blockButton(page, 'Seminario').first().click();
  const edit = page.getByRole('dialog', { name: 'Editar bloque' });
  await expect(edit).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const editBox = (await edit.boundingBox())!;
  expect(editBox.x + editBox.width).toBeLessThanOrEqual(viewport.width);
  await page.keyboard.press('Escape');

  assertClean();
});

test('a second user gets an empty agenda and cannot open the first user’s blocks', async ({
  page,
  browser,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  const [subject] = await apiSubjects(page);
  const res = await page.request.post('/api/schedule', {
    data: {
      type: 'STUDY',
      subjectId: subject!.id,
      title: 'Privado de A',
      date: bogotaToday(0),
      startTime: '10:00',
      endTime: '11:00',
    },
  });
  expect(res.status()).toBe(201);
  const { block } = await res.json();

  const second = await browser.newContext({ ...test.info().project.use });
  const other = await second.newPage();
  const assertOtherClean = watch(other);
  await register(other, uniqueEmail(), 'Otra Persona');
  await completeOnboarding(other, 'Semestre', period());
  await other.goto('/calendar');
  await expect(other.getByText('No tienes bloques esta semana.')).toBeVisible();
  await expect(other.getByText('Privado de A')).toHaveCount(0);

  const peek = await other.request.get(`/api/schedule/${block.id}`);
  const ghost = await other.request.get('/api/schedule/0b0c2d5e-8f64-4c5f-9a43-7d7a3f1d2b11');
  expect(peek.status()).toBe(404);
  expect(await peek.json()).toEqual(await ghost.json());

  await second.close();
  assertClean();
  assertOtherClean();
});

test('a subject that has agenda blocks cannot be deleted, and the message says why', async ({
  page,
}) => {
  const assertClean = watch(page, ['409 /api/subjects/*']); // the refusal is the point of this test
  await newUser(page, ['Redes']);
  const [subject] = await apiSubjects(page);
  const res = await page.request.post('/api/schedule', {
    data: {
      type: 'CLASS',
      subjectId: subject!.id,
      title: 'Redes',
      date: bogotaToday(0),
      startTime: '08:00',
      endTime: '10:00',
    },
  });
  expect(res.status()).toBe(201);

  await nav(page).getByRole('link', { name: 'Asignaturas' }).click();
  await page.getByRole('button', { name: 'Eliminar Redes' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Redes?' });
  await confirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(confirm.getByRole('alert')).toHaveText(
    'La asignatura tiene actividades o bloques de agenda asociados.',
  );
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Redes' })).toBeVisible();

  assertClean();
});
