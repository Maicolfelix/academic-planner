import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  expectNoHorizontalOverflow,
  inBogota,
  register,
  uniqueEmail,
  watch,
  openActivityMenu,
} from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Offsets sit in the MIDDLE of each Radar band (5 h, 2 d, 5 d, 10 d), so the minute rounding of the form can
// never move an activity across a limit and nothing depends on the exact second the test runs.

async function newUserWithSubject(page: Page, subjectName = 'Redes') {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, subjectName);
}

async function make(
  page: Page,
  title: string,
  offsetMs: number,
  extra: { priority?: 'LOW' | 'MEDIUM' | 'HIGH' } = {},
) {
  const [subject] = await apiSubjects(page);
  return apiCreateActivity(page, {
    subjectId: subject!.id,
    title,
    type: 'TASK',
    ...inBogota(offsetMs),
    ...extra,
  });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const attention = (page: Page) => page.getByRole('region', { name: '¿Qué hago ahora?' });
// The hero is a carousel: every activity has a slide, the one on screen is the only one that is not inert.
const current = (page: Page) =>
  attention(page).locator('[aria-roledescription="actividad"]:not([inert])');
const reasonsOf = (page: Page) => current(page).getByRole('listitem');
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });
const goHome = async (page: Page) => {
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
};
const goActivities = async (page: Page) => {
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await expect(page).toHaveURL(/\/activities$/);
};
const recommended = (page: Page, title: string) =>
  expect(current(page).getByRole('article', { name: title })).toBeVisible();

test('¿Qué hago ahora?: recommendation, reasons, live changes without reloading, empty state', async ({
  page,
}) => {
  const assertClean = watch(page);

  // 1-3. New user, current period, subject "Redes".
  await newUserWithSubject(page);

  // 4-6. LOW in 10 days, HIGH in 5 days, LOW in 5 hours (plus a MEDIUM one in 5 days to show re-ranking later).
  await make(page, 'Lectura lejana', 10 * DAY, { priority: 'LOW' });
  await make(page, 'Proyecto', 5 * DAY, { priority: 'HIGH' });
  await make(page, 'Quiz', 5 * DAY + HOUR, { priority: 'MEDIUM' });
  await make(page, 'Taller de hoy', 5 * HOUR, { priority: 'LOW' });

  // 7-9. Dashboard: the activity due in 5 hours opens the hero (they follow the deadline, not the priority).
  await page.goto('/dashboard');
  await expect(
    attention(page).getByRole('heading', { level: 2, name: '¿Qué hago ahora?' }),
  ).toBeVisible();
  await recommended(page, 'Taller de hoy');
  await expect(current(page)).toContainText('Próxima entrega.');
  await expect(current(page)).toContainText('¿Por qué esta?');
  await expect(reasonsOf(page)).toHaveText(['Vence en menos de 24 horas.']);
  await expect(current(page).getByText('Atención inmediata')).toBeVisible();
  await expect(current(page).getByText('Redes')).toBeVisible();
  await expect(attention(page)).not.toContainText(/score|puntos|debes|urgente|atrasad/i);
  // One slide per activity (four), one dot per slide, and only the first is on screen.
  await expect(attention(page).locator('[aria-roledescription="actividad"]')).toHaveCount(4);
  await expect(attention(page).getByRole('button', { name: /Ver actividad \d de 4/ })).toHaveCount(
    4,
  );
  await expect(
    attention(page).locator('[aria-roledescription="actividad"]:not([inert])'),
  ).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  // A marker proves nothing below reloads the page.
  await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
  const stillSamePage = () =>
    page.evaluate(() => (window as unknown as { __kept?: number }).__kept === 1);

  // 10-11. Finish it; with no F5 the suggestion changes to the HIGH priority one.
  await goActivities(page);
  await page.getByLabel('Cambiar estado de Taller de hoy').selectOption('Finalizada');
  await expect(page.getByLabel('Cambiar estado de Taller de hoy')).toHaveValue('COMPLETED');
  await goHome(page);
  await recommended(page, 'Proyecto');
  await expect(reasonsOf(page)).toHaveText(['Vence durante esta semana.', 'Tiene prioridad alta.']);
  expect(await stillSamePage()).toBe(true);

  // 12-13. Lower that one's priority: the hero follows the deadline, so it does not move.
  await goActivities(page);
  await page.getByRole('button', { name: 'Editar Proyecto' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar actividad' });
  // Non-default fields are already visible ("Más opciones" opens by itself): open it only if it is closed.
  if (!(await edit.getByLabel('Prioridad').isVisible()))
    await edit.getByText('Más opciones').click();
  await edit.getByLabel('Prioridad').selectOption({ label: 'Baja' });
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toBeHidden();
  await goHome(page);
  await recommended(page, 'Proyecto');
  await expect(reasonsOf(page)).toHaveText(['Vence durante esta semana.']);
  expect(await stillSamePage()).toBe(true);
  await attention(page).getByRole('button', { name: 'Ver actividad 2 de 3' }).click();
  await recommended(page, 'Quiz');
  await expect(reasonsOf(page)).toHaveText(['Vence durante esta semana.']);

  // 14-15. Start the quiz: it says why.
  await goActivities(page);
  await page.getByLabel('Cambiar estado de Quiz').selectOption('En proceso');
  await expect(page.getByLabel('Cambiar estado de Quiz')).toHaveValue('IN_PROGRESS');
  await goHome(page);
  await attention(page).getByRole('button', { name: 'Ver actividad 2 de 3' }).click();
  await recommended(page, 'Quiz');
  await expect(reasonsOf(page)).toHaveText([
    'Vence durante esta semana.',
    'Ya comenzaste esta actividad.',
  ]);
  await expect(current(page).getByText('En proceso')).toBeVisible();

  // 16-17. Delete it: the strip has one slide fewer and the first one is on screen.
  await goActivities(page);
  await openActivityMenu(page, 'Quiz');
  await page.getByRole('menuitem', { name: 'Eliminar Quiz' }).click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Quiz?' })
    .getByRole('button', { name: 'Eliminar' })
    .click();
  await expect(card(page, 'Quiz')).toHaveCount(0);
  await goHome(page);
  await recommended(page, 'Proyecto');
  expect(await stillSamePage()).toBe(true);

  // 18-19. Finish everything: no artificial suggestion, a calm empty state.
  await goActivities(page);
  await page.getByLabel('Cambiar estado de Proyecto').selectOption('Finalizada');
  await expect(page.getByLabel('Cambiar estado de Proyecto')).toHaveValue('COMPLETED');
  await page.getByLabel('Cambiar estado de Lectura lejana').selectOption('Finalizada');
  await expect(page.getByLabel('Cambiar estado de Lectura lejana')).toHaveValue('COMPLETED');
  await goHome(page);
  await expect(attention(page)).toContainText('No tienes actividades pendientes en este momento.');
  await expect(attention(page).getByRole('article')).toHaveCount(0);
  await expect(attention(page).getByRole('link', { name: /Ver actividad/ })).toHaveCount(0);
  await expect(attention(page).getByRole('button', { name: /Ver actividad/ })).toHaveCount(0);
  expect(await stillSamePage()).toBe(true);

  // 20. No console errors, no uncaught exceptions and no failed API calls along the whole flow.
  assertClean();
});

test('"Ver actividad" opens that activity for editing', async ({ page }) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await make(page, 'Informe de laboratorio', 5 * HOUR);
  await make(page, 'Otra más lejana', 10 * DAY);

  await page.goto('/dashboard');
  await recommended(page, 'Informe de laboratorio');
  await current(page)
    .getByRole('link', { name: /Ver actividad/ })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Título')).toHaveValue('Informe de laboratorio');
  await expect(page).toHaveURL(/\/activities\?edit=/); // the dialog is derived from the link...
  await dialog.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/activities$/); // ...and closing it cleans the URL
  assertClean();
});

test('calm tone: overdue only, and everything under control', async ({ page }) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await make(page, 'Entrega atrasada', -2 * DAY, { priority: 'HIGH' });

  await page.goto('/dashboard');
  await recommended(page, 'Entrega atrasada');
  await expect(attention(page)).toContainText(
    'Tienes actividades vencidas. Esta es la que actualmente requiere mayor atención.',
  );
  await expect(reasonsOf(page)).toHaveText([
    'Esta actividad ya está vencida.',
    'Venció hace 2 días.',
    'Tiene prioridad alta.',
  ]);
  await expect(attention(page)).not.toContainText(/Estás|urgente|culpa|atrasado/i); // no blame, no alarm

  // Finish it and add one that is far away: calm wording.
  await goActivities(page);
  await page.getByLabel('Cambiar estado de Entrega atrasada').selectOption('Finalizada');
  await expect(page.getByLabel('Cambiar estado de Entrega atrasada')).toHaveValue('COMPLETED');
  await make(page, 'Proyecto de fin de curso', 20 * DAY, { priority: 'LOW' });
  await page.reload();
  await goHome(page);
  await recommended(page, 'Proyecto de fin de curso');
  await expect(attention(page)).toContainText(
    'Todo está bajo control. Si quieres avanzar, podrías continuar con:',
  );
  await expect(reasonsOf(page)).toHaveText(['La fecha límite aún está a más de una semana.']);
  assertClean();
});

test('layout and accessibility: long title, three reasons, keyboard, headings', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page, 'Asignatura con un nombre bastante largo de verdad');
  const long = `Entrega ${'muy larga '.repeat(8)}Supercalifragilisticoespialidosoynadamás`;
  const created = await make(page, long, 5 * HOUR, { priority: 'HIGH' });
  const res = await page.request.patch(`/api/activities/${created.id}`, {
    data: { status: 'IN_PROGRESS' },
  });
  expect(res.status()).toBe(200);

  await page.goto('/dashboard');
  await expect(attention(page).getByRole('heading', { level: 2 })).toBeVisible();
  await expect(attention(page).getByRole('article')).toContainText('Entrega muy larga');
  await expect(reasonsOf(page)).toHaveText([
    'Vence en menos de 24 horas.',
    'Tiene prioridad alta.',
    'Ya comenzaste esta actividad.',
  ]);
  await expectNoHorizontalOverflow(page);

  // Everything stays inside the viewport and the target is comfortable to press.
  const viewport = page.viewportSize()!;
  const box = (await attention(page).getByRole('article').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  const link = current(page).getByRole('link', { name: /Ver actividad/ });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Keyboard: the link is reachable and Enter opens the activity.
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Editar actividad' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('the suggestion depends on the instant, not on the browser’s timezone', async ({
  browser,
}) => {
  // The browser believes it is in Tokyo (UTC+9); the profile is Bogotá (UTC-5).
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await make(page, 'Cercana de prioridad baja', 5 * HOUR, { priority: 'LOW' });
  await make(page, 'Lejana de prioridad alta', 10 * DAY, { priority: 'HIGH' });

  await page.goto('/dashboard');
  await recommended(page, 'Cercana de prioridad baja');
  await expect(reasonsOf(page)).toHaveText(['Vence en menos de 24 horas.']);
  assertClean();
  await context.close();
});
