import { addDays, toLocalParts, weekdayOf } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  login,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Smart capture, end to end: the student writes ONCE (one activity or several, in loose language), the app reads it, shows
 * what it understood, asks only what is in doubt, and creates everything with one confirmation — and what is written or
 * decided survives leaving the page, reloading and a closed dialog. Quick Capture and the Inbox share the same review.
 *
 * The browser clock decides what "today" is, so the days are asserted by their weekday and hour (and, where it matters, by
 * the week they fall in), never by a fixed date.
 */

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const quick = (page: Page) => page.getByRole('region', { name: 'Captura rápida' });
const box = (page: Page) => quick(page).getByLabel('Escribe lo que tienes pendiente');
const cards = (page: Page) => quick(page).getByRole('article');
const createButton = (page: Page, n?: number) =>
  quick(page).getByRole('button', {
    name:
      n === undefined
        ? /^Crear \d+ actividades?$/
        : `Crear ${n} ${n === 1 ? 'actividad' : 'actividades'}`,
  });

async function newUser(page: Page, subjects: string[] = ['Redes de Computadores']) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Semestre de prueba', period());
  for (const name of subjects) await addSubjectViaUi(page, name);
  return email;
}

async function write(page: Page, text: string) {
  await page.goto('/dashboard');
  await box(page).fill(text);
  await quick(page).getByRole('button', { name: 'Interpretar', exact: true }).click();
  await expect(quick(page).locator('#capture-review-title')).toBeVisible();
}

interface Created {
  title: string;
  type: string;
  subjectId: string | null;
  hasTime: boolean;
  dueAt: string;
  description: string | null;
}
const activities = async (page: Page) =>
  (await (await page.request.get('/api/activities')).json()).activities as Created[];
const subjectsOf = async (page: Page) =>
  (await (await page.request.get('/api/subjects')).json()).subjects as {
    id: string;
    name: string;
  }[];

/** The activity as the student lives it: weekday (1 = Monday), local day and hour. */
const local = (a: Created) => {
  const parts = toLocalParts(a.dueAt, 'America/Bogota');
  return { weekday: weekdayOf(parts.date), date: parts.date, time: a.hasTime ? parts.time : null };
};
const draftKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('academic-planner:draft:')),
  );

const CRITICAL =
  'Ensayo el día lunes, martes, jueves y viernes los dos primeros días a las 7:30 am y los otros dos días a las 5:40 PM';
const CONTRACT_2 =
  'tengo un parcial de redes para el dia jueves de la otra semana y un ensayo de ciberseguridad para el lunes el parcial de redes es a las 7:00 AM y el ensayo es a las 5 de la tarde';
const CONTRACT_3 =
  'Tengo un examen de redes el lunes a las 7 am y un ensayo de ciberseguridad el martes a las 9 el martes y tengo dos tareas para dos dias distintos uno para el jueves y otro para el viernes las dos tareas tengo que entregarlas a las 8 AM';

test('1. four days with two hours by position: four cards, nothing to answer, one click, four activities', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, CRITICAL);

  await expect(cards(page)).toHaveCount(4);
  const summaries = ['Lunes', 'Martes', 'Jueves', 'Viernes'];
  const hours = ['7:30 a. m.', '7:30 a. m.', '5:40 p. m.', '5:40 p. m.'];
  for (const [i, day] of summaries.entries()) {
    const card = cards(page).nth(i);
    await expect(card.getByRole('heading', { level: 4 })).toContainText('Ensayo');
    await expect(card).toContainText(day);
    await expect(card).toContainText(hours[i]!);
    await expect(card).toContainText('Sin asignatura');
    await expect(card).toContainText('Lista');
    await expect(card.getByRole('checkbox')).toBeChecked();
  }
  // No question of any kind: no "falta algo", no shared answer, no field to fill.
  await expect(quick(page).getByText('Falta algo')).toHaveCount(0);
  await expect(quick(page).getByText('Una sola respuesta')).toHaveCount(0);
  await expect(createButton(page, 4)).toBeEnabled();
  expect(await activities(page)).toHaveLength(0); // interpreting creates nothing

  await createButton(page, 4).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '4 actividades creadas.' }),
  ).toBeVisible();

  const created = await activities(page);
  expect(created).toHaveLength(4);
  expect(created.every((a) => a.title === 'Ensayo' && a.subjectId === null)).toBe(true);
  const lived = created.map(local).sort((a, b) => a.date.localeCompare(b.date));
  expect(lived.map((l) => l.weekday)).toEqual([1, 2, 4, 5]);
  expect(lived.map((l) => l.time)).toEqual(['07:30', '07:30', '17:40', '17:40']);
  // One coherent run: each day after the previous one, in the same week.
  expect(lived[3]!.date).toBe(addDays(lived[0]!.date, 4));
  assertClean();
});

test('2. a midterm of Redes and an essay of Ciberseguridad: each keeps its own subject, day and hour', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores', 'Ciberseguridad']);
  await write(page, CONTRACT_2);

  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText('Jueves');
  await expect(cards(page).nth(0)).toContainText('7:00 a. m.');
  await expect(cards(page).nth(0)).toContainText('Redes de Computadores');
  await expect(cards(page).nth(0)).toContainText('Parcial');
  await expect(cards(page).nth(1)).toContainText('Ensayo');
  await expect(cards(page).nth(1)).toContainText('Lunes');
  await expect(cards(page).nth(1)).toContainText('5:00 p. m.');
  await expect(cards(page).nth(1)).toContainText('Ciberseguridad');
  await expect(quick(page).getByText('Falta algo')).toHaveCount(0);

  await createButton(page, 2).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '2 actividades creadas.' }),
  ).toBeVisible();

  const subs = await subjectsOf(page);
  const redes = subs.find((s) => s.name === 'Redes de Computadores')!.id;
  const ciber = subs.find((s) => s.name === 'Ciberseguridad')!.id;
  const created = await activities(page);
  const exam = created.find((a) => a.title === 'Parcial')!;
  const essay = created.find((a) => a.title === 'Ensayo')!;
  expect([exam.subjectId, essay.subjectId]).toEqual([redes, ciber]);
  expect(local(exam)).toMatchObject({ weekday: 4, time: '07:00' });
  expect(local(essay)).toMatchObject({ weekday: 1, time: '17:00' });
  // "el jueves de la otra semana": the Thursday of NEXT week, whatever day today is.
  const today = bogotaToday();
  const mondayThis = addDays(today, 1 - weekdayOf(today));
  expect(local(exam).date).toBe(addDays(mondayThis, 7 + 3));
  assertClean();
});

test('3. loose language: exam + essay + two tasks + a later "las dos tareas" are four activities', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores', 'Ciberseguridad']);
  await write(page, CONTRACT_3);

  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).nth(0)).toContainText('Redes de Computadores');
  await expect(cards(page).nth(0)).toContainText('7:00 a. m.');
  await expect(cards(page).nth(2)).toContainText('8:00 a. m.');
  await expect(cards(page).nth(3)).toContainText('8:00 a. m.');
  // "el martes … el martes" is ONE day: only four cards, and the essay asks the only thing the text does not say.
  const essay = cards(page).nth(1);
  await expect(essay).toContainText('Falta algo');
  await expect(essay.getByRole('button', { name: '9:00 a. m.' })).toBeVisible();
  await expect(essay.getByRole('button', { name: '9:00 p. m.' })).toBeVisible();
  await expect(quick(page).getByText('Falta algo')).toHaveCount(1);
  await expect(essay.getByRole('checkbox')).not.toBeChecked(); // a card in doubt is not ticked until it is settled
  await expect(createButton(page, 3)).toBeEnabled();

  await essay.getByRole('button', { name: '9:00 a. m.' }).click();
  await expect(quick(page).getByText('Falta algo')).toHaveCount(0);
  await expect(createButton(page, 4)).toBeEnabled();
  await createButton(page, 4).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '4 actividades creadas.' }),
  ).toBeVisible();

  const created = (await activities(page)).map((a) => ({ a, ...local(a) }));
  const tasks = created
    .filter((c) => c.a.title === 'Tarea')
    .sort((x, y) => x.date.localeCompare(y.date));
  expect(tasks.map((t) => [t.weekday, t.time])).toEqual([
    [4, '08:00'],
    [5, '08:00'],
  ]);
  expect(created.find((c) => c.a.title === 'Ensayo')).toMatchObject({ weekday: 2, time: '09:00' });
  expect(created.find((c) => c.a.title === 'Parcial')).toMatchObject({ weekday: 1, time: '07:00' });
  assertClean();
});

test('4. a subject that is named but does not exist is the ONLY thing asked, and it is created only on confirming', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores']);
  await write(page, 'parcial de criptografía el martes y tarea de redes el jueves');

  await expect(cards(page)).toHaveCount(2);
  const ask = cards(page).nth(0);
  await expect(ask).toContainText('Falta algo');
  await expect(ask).toContainText('No tienes la asignatura «Criptografía».');
  await expect(cards(page).nth(1)).toContainText('Lista');
  await expect(quick(page).getByText('Falta algo')).toHaveCount(1);

  await ask.getByRole('button', { name: 'Crear «Criptografía»' }).click();
  await expect(ask).toContainText('Se creará la asignatura «Criptografía» al confirmar.');
  // Nothing is created by choosing it: the subject does not exist yet.
  expect((await subjectsOf(page)).map((s) => s.name)).toEqual(['Redes de Computadores']);

  await createButton(page, 2).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '2 actividades creadas.' }),
  ).toBeVisible();
  const subs = await subjectsOf(page);
  const crypto = subs.find((s) => s.name === 'Criptografía');
  expect(crypto).toBeDefined();
  const created = await activities(page);
  expect(created.find((a) => a.title === 'Parcial')!.subjectId).toBe(crypto!.id);
  assertClean();
});

test('5. several activities that name the same new subject: ONE question, ONE subject created', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores']);
  await write(page, 'parcial de criptografía martes y tarea de criptografía jueves');

  await expect(quick(page).getByText('Una sola respuesta para 2 actividades')).toBeVisible();
  await quick(page).getByRole('button', { name: 'Crear «Criptografía»' }).first().click();
  await expect(quick(page).getByText('Una sola respuesta')).toHaveCount(0);
  await expect(quick(page).getByText('Falta algo')).toHaveCount(0);
  await expect(quick(page).getByText('Se creará la asignatura «Criptografía».')).toBeVisible();

  await createButton(page, 2).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '2 actividades creadas.' }),
  ).toBeVisible();
  const subs = (await subjectsOf(page)).filter((s) => s.name === 'Criptografía');
  expect(subs).toHaveLength(1);
  expect((await activities(page)).every((a) => a.subjectId === subs[0]!.id)).toBe(true);
  assertClean();
});

test('6. days sharing one ambiguous hour: ONE question answers all of them', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, 'Ensayo lunes, martes y jueves a las 7:30');

  await expect(quick(page).getByText('Una sola respuesta para 3 actividades')).toBeVisible();
  await expect(quick(page).getByRole('button', { name: '7:30 p. m.' })).toHaveCount(1);
  await expect(createButton(page, 0)).toBeDisabled();
  await quick(page).getByRole('button', { name: '7:30 p. m.' }).click();

  await expect(quick(page).getByText('Una sola respuesta')).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await expect(cards(page).nth(i)).toContainText('7:30 p. m.');
    await expect(cards(page).nth(i)).toContainText('Lista');
  }
  await createButton(page, 3).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '3 actividades creadas.' }),
  ).toBeVisible();
  expect((await activities(page)).map((a) => local(a).time)).toEqual(['19:30', '19:30', '19:30']);
  assertClean();
});

test('7. a card the student unticks is not created', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, CRITICAL);
  await cards(page).nth(1).getByRole('checkbox').uncheck();
  await expect(createButton(page, 3)).toBeEnabled();
  await createButton(page, 3).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '3 actividades creadas.' }),
  ).toBeVisible();
  const weekdays = (await activities(page)).map((a) => local(a).weekday).sort();
  expect(weekdays).toEqual([1, 4, 5]); // the Tuesday is not there
  assertClean();
});

test('8. a ticked card the server refuses: NOTHING is created, and the card says why', async ({
  page,
}) => {
  const assertClean = watch(page, ['400 /api/capture/confirm']);
  await newUser(page, ['Redes de Computadores', 'Bases de Datos']);
  await write(page, 'parcial de redes el martes y quiz de bases el miércoles y tarea el jueves');
  await expect(cards(page)).toHaveCount(3);

  // The subject of the first card is deleted meanwhile (from another tab, say): the server refuses that card.
  const redes = (await subjectsOf(page)).find((s) => s.name === 'Redes de Computadores')!;
  expect((await page.request.delete(`/api/subjects/${redes.id}`)).status()).toBe(204);

  await createButton(page, 3).click();
  await expect(cards(page).nth(0).getByRole('alert')).toContainText('Asignatura no encontrada.');
  // All or nothing: the two good cards were NOT created either.
  expect(await activities(page)).toHaveLength(0);
  assertClean();
});

test('9. two taps on the button do not create anything twice', async ({ page }) => {
  const assertClean = watch(page, ['409 /api/capture/confirm']);
  await newUser(page);
  await write(page, CRITICAL);
  await createButton(page, 4).dblclick();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '4 actividades creadas.' }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(await activities(page)).toHaveLength(4);
  assertClean();
});

test('10. writing the same thing again: the copy is flagged, left unticked, and created only if the student insists', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  const text = 'parcial de redes el 15/12';
  await write(page, text);
  await createButton(page, 1).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '1 actividad creada.' }),
  ).toBeVisible();

  await write(page, text);
  const card = cards(page).nth(0);
  await expect(card).toContainText('Ya tienes «Parcial»');
  await expect(card.getByRole('checkbox')).not.toBeChecked();
  await expect(createButton(page, 0)).toBeDisabled();
  await card.getByRole('checkbox').check();
  await createButton(page, 1).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '1 actividad creada.' }),
  ).toBeVisible();
  expect(await activities(page)).toHaveLength(2);
  assertClean();
});

test('11. interpret, answer, leave, come back: the same review with the answer, and nothing interpreted again', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  const parses: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/capture/parse')) parses.push(r.url());
  });
  await write(page, 'Ensayo lunes, martes y jueves a las 7:30');
  await quick(page).getByRole('button', { name: '7:30 p. m.' }).click();
  await expect(cards(page).nth(0)).toContainText('7:30 p. m.');
  expect(parses).toHaveLength(1);

  await page.goto('/activities');
  await expect(page.getByRole('heading', { level: 1, name: 'Actividades' })).toBeVisible();
  await page.goto('/dashboard');

  await expect(cards(page)).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(cards(page).nth(i)).toContainText('7:30 p. m.');
  await expect(quick(page).getByText('Retomé lo que tenías sin terminar.')).toBeVisible();
  expect(parses).toHaveLength(1); // the draft was shown as it was: no new interpretation
  await expect(createButton(page, 3)).toBeEnabled();
  assertClean();
});

test('12. a reload keeps the text and the review', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto('/dashboard');
  await box(page).fill('tarea de redes el viernes');
  await expect.poll(() => draftKeys(page)).toHaveLength(1); // kept a moment after typing
  await page.reload();
  await expect(box(page)).toHaveValue('tarea de redes el viernes');

  await quick(page).getByRole('button', { name: 'Interpretar', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await cards(page).nth(0).getByRole('button', { name: 'Editar' }).click();
  await cards(page).nth(0).getByLabel('Título', { exact: true }).fill('Tarea 1 de Redes');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).nth(0).getByRole('heading', { level: 4 })).toContainText(
    'Tarea 1 de Redes',
  );
  assertClean();
});

test('13. an activity half typed survives closing the dialog, and "Retomar" brings it back', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill('Informe de laboratorio');
  await dialog.getByLabel('Fecha').fill(bogotaToday(9));
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Descripción').fill('Con las gráficas de la práctica 3');
  await dialog.getByLabel('Hora (opcional)').fill('14:30');

  // Closing never asks and never loses it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText('Tienes una actividad sin terminar: «Informe de laboratorio».'),
  ).toBeVisible();
  expect(await draftKeys(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Retomar' }).click();
  const back = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(back.getByLabel('Título')).toHaveValue('Informe de laboratorio');
  await expect(back.getByLabel('Fecha')).toHaveValue(bogotaToday(9));
  await expect(back.getByLabel('Descripción')).toHaveValue('Con las gráficas de la práctica 3');
  await expect(back.getByLabel('Hora (opcional)')).toHaveValue('14:30');
  await expect(back.getByText('Retomé lo que habías escrito.')).toBeVisible();
  assertClean();
});

test('14. an activity half typed survives a reload, and saving it removes the draft', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  let dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill('Resumen del capítulo 4');
  await dialog.getByLabel('Fecha').fill(bogotaToday(5));
  await expect.poll(() => draftKeys(page)).toHaveLength(1);

  await page.reload();
  await expect(
    page.getByText('Tienes una actividad sin terminar: «Resumen del capítulo 4».'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retomar' }).click();
  dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog.getByLabel('Título')).toHaveValue('Resumen del capítulo 4');

  // 15. Saving removes the draft; nothing is offered back.
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Actividad creada.' })).toBeVisible();
  expect(await draftKeys(page)).toEqual([]);
  await expect(page.getByText('Tienes una actividad sin terminar')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Tienes una actividad sin terminar')).toHaveCount(0);
  assertClean();
});

test('15. discarding a draft is explicit, and an empty form leaves none', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await page.keyboard.press('Escape'); // nothing typed: nothing kept
  await expect(dialog).toBeHidden();
  expect(await draftKeys(page)).toEqual([]);

  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  await dialog.getByLabel('Título').fill('Lo descarto');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(dialog.getByLabel('Título')).toHaveValue('');
  await expect.poll(() => draftKeys(page)).toEqual([]);
  assertClean();
});

test('16. confirming the batch removes the capture draft; nothing is offered back', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, CRITICAL);
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await createButton(page, 4).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '4 actividades creadas.' }),
  ).toBeVisible();
  expect(await draftKeys(page)).toEqual([]);
  await page.reload();
  await expect(box(page)).toHaveValue('');
  await expect(quick(page).getByText('Retomé lo que tenías sin terminar.')).toHaveCount(0);
  assertClean();
});

test("17. two accounts in one browser never see each other's drafts", async ({ page }) => {
  const assertClean = watch(page);
  const emailA = await newUser(page);
  await page.goto('/dashboard');
  await box(page).fill('el borrador privado de A');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  await page.getByRole('banner').getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await newUser(page); // B, in the same browser profile
  await page.goto('/dashboard');
  await expect(box(page)).toHaveValue('');
  await expect(quick(page).getByText('Retomé lo que tenías sin terminar.')).toHaveCount(0);
  await page.goto('/activities');
  await expect(page.getByText('Tienes una actividad sin terminar')).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, emailA);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(box(page)).toHaveValue('el borrador privado de A'); // A's own draft is back
  assertClean();
});

test('18. a corrupt, expired or foreign draft is ignored: the app keeps working', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  const me = (await (await page.request.get('/api/auth/me')).json()).user as { id: string };
  const key = `academic-planner:draft:v1:${me.id}:capture-quick`;

  for (const value of [
    '{no es json',
    JSON.stringify({
      version: 1,
      updatedAt: Date.now() - 10 * 86_400_000,
      payload: { engine: 1, text: 'viejo', review: null },
    }),
    JSON.stringify({ version: 99, updatedAt: Date.now(), payload: {} }),
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      payload: { engine: 1, text: 5, review: 'x' },
    }),
  ]) {
    await page.goto('/dashboard');
    await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [key, value]);
    await page.reload();
    await expect(box(page)).toBeVisible();
    await expect(box(page)).toHaveValue('');
    await expect(quick(page).getByText('Retomé lo que tenías sin terminar.')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull(); // dropped, not repaired
  }
  // And the flow still works afterwards.
  await write(page, 'tarea de redes el viernes');
  await expect(cards(page)).toHaveCount(1);
  assertClean();
});

test('19. the Inbox is the same flow and the same review, reading a pasted message conservatively', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Bases de Datos']);
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Bandeja académica' })).toBeVisible();
  await page
    .getByLabel('Mensaje del profesor o instrucción académica')
    .fill(
      'Buenas tardes estudiantes. El jueves tendremos quiz de Bases de Datos a las 8 a. m. y el viernes deben entregar el taller de Bioestadística. Gracias por su atención.',
    );
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  const articles = page.getByRole('article');
  await expect(articles).toHaveCount(2);
  await expect(articles.nth(0)).toContainText('Quiz');
  await expect(articles.nth(0)).toContainText('8:00 a. m.');
  await expect(articles.nth(0)).toContainText('Bases de Datos');
  await page.getByRole('button', { name: 'Crear 2 actividades' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '2 actividades creadas.' }),
  ).toBeVisible();
  expect(await activities(page)).toHaveLength(2);

  // A message that is not about an activity says so and keeps the text.
  await page
    .getByLabel('Mensaje del profesor o instrucción académica')
    .fill('Buenas tardes estudiantes. Gracias por su atención.');
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No encontramos actividades claras' }),
  ).toBeVisible();
  await expect(page.getByLabel('Mensaje del profesor o instrucción académica')).toHaveValue(
    'Buenas tardes estudiantes. Gracias por su atención.',
  );
  assertClean();
});

test('20. the review is readable at every width: no sideways scroll, touch targets of 44 px', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores']);
  for (const width of [320, 390, 430, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await write(page, CONTRACT_3);
    await expect(cards(page)).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
    // Every control of the review is at least 44 px tall.
    const small = await quick(page)
      .locator(
        'button, input[type="checkbox"], summary, select, input:not([type="checkbox"]), textarea',
      )
      .evaluateAll((els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const label = el.closest('label');
            const box = (label ?? el).getBoundingClientRect();
            return r.width > 0 && Math.max(r.height, box.height) < 43.5;
          })
          .map((el) => `${el.tagName} ${el.textContent?.slice(0, 20) ?? ''}`),
      );
    expect(small, `controls under 44 px at ${width}`).toEqual([]);
    await quick(page).getByRole('button', { name: 'Descartar' }).click();
  }
  assertClean();
});

test('21. what is said ABOUT the activity becomes its description: collapsed, editable, and it is saved', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, 'Tarea de programación el viernes, hay que subirla en PDF al campus');
  await expect(cards(page)).toHaveCount(1);
  const card = cards(page).first();
  await expect(card).toContainText('Lista');
  // Collapsed by default: the text is in the DOM but the card does not spend a line of its own on it.
  await expect(card.locator('details')).not.toHaveAttribute('open', '');
  await card.getByText('Descripción', { exact: true }).click();
  await expect(card).toContainText('Hay que subirla en PDF al campus');
  // Editable in the card.
  await card.getByRole('button', { name: 'Editar' }).click();
  const field = card.getByLabel('Descripción (opcional)');
  await expect(field).toHaveValue('Hay que subirla en PDF al campus');
  await field.fill('Subir el PDF al campus antes de las 11');
  await createButton(page, 1).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '1 actividad creada.' }),
  ).toBeVisible();
  const [created] = await activities(page);
  expect(created!.title).toBe('Tarea programación');
  expect(created!.description).toBe('Subir el PDF al campus antes de las 11');
  assertClean();
});

test('22. an hour that was written but could not be tied to the activity is not silently dropped: it says so', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, 'Tarea a las 8 y a las 10');
  const card = cards(page).first();
  await expect(card).toContainText('Falta algo');
  await expect(card).toContainText('Mencionaste horas');
  await expect(card.getByRole('button', { name: '8:00 a. m.' })).toBeVisible();
  await expect(card.getByRole('button', { name: '10:00 a. m.' })).toBeVisible();
  // Only what the text leaves open is asked (the day it never gave, and the hour it gave twice): no subject or description question.
  await expect(card.getByRole('group').and(card.getByLabel(/por decidir/))).toHaveCount(2);
  await expect(card.getByRole('group', { name: 'Asignatura por decidir' })).toHaveCount(0);
  await expect(card.getByRole('group', { name: 'Descripción por decidir' })).toHaveCount(0);
  assertClean();
});

test('23. a short activity with nothing else is READY and asks nothing (the optional is never a question)', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, 'Tarea jueves');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Lista');
  await expect(cards(page).first().getByRole('group')).toHaveCount(0);
  await expect(cards(page).first().locator('details')).toHaveCount(0);
  assertClean();
});

/** n distinct activities on n different upcoming days: "Taller 1 el 11/10, Taller 2 el 12/10 …" (Bogotá days). */
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const [, m, d] = bogotaToday(i + 1).split('-');
    return `Taller ${i + 1} el ${d}/${m}`;
  }).join(', ');

test('24. thirty activities: the summary counts them, the review is usable, one click creates all thirty', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, many(30));
  await expect(cards(page)).toHaveCount(30);
  await expect(quick(page).locator('#capture-review-title')).toHaveText(
    '30 actividades encontradas',
  );
  await expect(quick(page).getByText('30 listas')).toBeVisible();
  await expect(createButton(page, 30)).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  // The last card is reachable and one of the middle ones can be taken out without touching the rest.
  await cards(page)
    .nth(14)
    .getByRole('button', { name: /^Quitar/ })
    .click();
  await expect(cards(page)).toHaveCount(29);
  await createButton(page, 29).click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '29 actividades creadas.' }),
  ).toBeVisible();
  expect(await activities(page)).toHaveLength(29);
  assertClean();
});

test('25. fifty are accepted; more than fifty are refused with a clear message and NOTHING is lost', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, many(50));
  await expect(cards(page)).toHaveCount(50);
  await expect(quick(page).getByText('50 listas')).toBeVisible();
  await quick(page).getByRole('button', { name: 'Volver al texto' }).click();

  const tooMany = many(51);
  await box(page).fill(tooMany);
  await quick(page).getByRole('button', { name: 'Interpretar', exact: true }).click();
  await expect(
    quick(page).getByText(
      'Encontré más de 50 actividades. Divide el mensaje en dos partes para revisarlas mejor.',
    ),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(box(page)).toHaveValue(tooMany); // the text is still there, to split
  expect(await activities(page)).toHaveLength(0);
  assertClean();
});

test('26. the description the student edits is part of the draft: a reload brings the review back with it', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, 'Tarea de programación el viernes, hay que subirla en PDF');
  const card = cards(page).first();
  await card.getByRole('button', { name: 'Editar' }).click();
  await card.getByLabel('Descripción (opcional)').fill('Nota que escribí yo');
  await expect.poll(() => draftKeys(page).then((k) => k.length)).toBeGreaterThan(0);
  await page.reload();
  await expect(quick(page).locator('#capture-review-title')).toBeVisible();
  await cards(page).first().getByText('Descripción', { exact: true }).click();
  await expect(cards(page).first()).toContainText('Nota que escribí yo');
  assertClean();
});
