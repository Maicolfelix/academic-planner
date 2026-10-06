import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { twoClassTable } from '../apps/api/test/scheduleImportFixtures';
import {
  LONG_SUBJECT,
  LONG_TITLE,
  PASSWORD,
  addSubjectViaUi,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  login,
  register,
  seedRichData,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Cross-cutting UX / accessibility checks (WCAG 2.1 AA oriented). They complement, not repeat, the flows of each
 * feature: the same crowded account (long names, every radar band, an overlapping class) is used everywhere.
 */

const ROUTES = [
  '/dashboard',
  '/subjects',
  '/activities',
  '/calendar',
  '/radar',
  '/progress',
  '/inbox',
  '/calendar/import',
];

async function richUser(page: Page) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Semestre de prueba', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  await addSubjectViaUi(page, 'Redes');
  await seedRichData(page);
  return email;
}

const axe = async (page: Page, label: string) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
};

// ───────────────────────── Automated accessibility audit ─────────────────────────

test('axe: no WCAG A/AA violations on any screen of a crowded account', async ({ page }) => {
  test.setTimeout(120_000);
  for (const route of ['/login', '/register']) {
    await page.goto(route);
    await axe(page, route);
  }
  await richUser(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await axe(page, route);
  }
});

test('axe: dialogs, filters, validation errors and the unsaved-changes question', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await richUser(page);

  await page.goto('/activities');
  await expect(page.getByRole('heading', { level: 1, name: 'Actividades' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Filtros' })).toBeVisible();
  const more = page.getByText(/^Más filtros/);
  if (await more.isVisible()) await more.click();
  await page.getByLabel('Prioridad').selectOption('HIGH');
  await axe(page, 'activities with filters');
  await page.getByRole('button', { name: 'Limpiar filtros' }).first().click();

  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click(); // validation errors
  await expect(dialog.getByText('Ingresa un título.')).toBeVisible();
  await axe(page, 'activity form with errors');
  await dialog.getByLabel('Título').fill('Algo');
  await page.keyboard.press('Escape'); // the unsaved-changes question
  await expect(dialog.getByRole('alert')).toBeVisible();
  await axe(page, 'unsaved-changes question');
  await dialog.getByRole('button', { name: 'Descartar cambios' }).click();

  await page
    .getByRole('button', { name: new RegExp(`^Eliminar ${LONG_TITLE.slice(0, 20)}`) })
    .click();
  await axe(page, 'delete dialog');
});

test('axe: Academic Inbox and schedule import with proposals, warnings and ambiguity', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await richUser(page);

  await page.goto('/inbox');
  await page
    .getByLabel('Mensaje del profesor o instrucción académica')
    .fill(
      'El martes tendremos parcial de Redes a las 10am y el viernes debemos entregar el taller de Bases.',
    );
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
  await axe(page, 'inbox with proposals');

  await page.goto('/calendar/import');
  await axe(page, 'import before reading');
  await page
    .getByLabel('Archivo del horario (imagen PNG o JPG, o PDF)')
    .setInputFiles({ name: 'horario.png', mimeType: 'image/png', buffer: twoClassTable() });
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 30_000 });
  await axe(page, 'import with proposals, a conflict and a duplicate-free preview');
});

// ───────────────────────── Structure and semantics ─────────────────────────

test('every screen has landmarks, exactly one h1 and its own document title', async ({ page }) => {
  await richUser(page);
  const titles = new Set<string>();
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    const title = await page.title();
    expect(title, route).toMatch(/ · Academic Planner$/);
    titles.add(title);
  }
  expect(titles.size, 'each screen announces a different title').toBe(ROUTES.length);
});

test('the product is called Academic Planner everywhere and the copy is clean Spanish', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByText('Academic Planner', { exact: true })).toBeVisible();
  await richUser(page);
  const english = /\b(Loading|Submit|Cancel|Delete|Save|Error|Undefined|null|NaN)\b/;
  const broken = /Ã.|â€|�|\bundefined\b|\[object/;
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text, `${route}: English text`).not.toMatch(english);
    expect(text, `${route}: broken characters`).not.toMatch(broken);
  }
});

test('times use one 12-hour style (a. m./p. m.) for classes and deadlines alike', async ({
  page,
}) => {
  await richUser(page);
  for (const route of ['/dashboard', '/calendar', '/activities']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    // The seeded classes are on Mondays. Below 1024 px the Agenda lists one day at a time (today's), so on any other
    // weekday there would be no class on screen: choose a Monday explicitly instead of depending on the day the suite runs.
    if (route === '/calendar') {
      if ((page.viewportSize()?.width ?? 1366) < 1024)
        await page.getByRole('button', { name: /^Lunes \d/ }).click();
    }
    const text = await page.locator('main').innerText();
    expect(text, `${route}: 24-hour range`).not.toMatch(/\b\d{2}:\d{2}\s?[–-]\s?\d{2}:\d{2}\b/);
    expect(text, `${route}: has a 12-hour time`).toMatch(/\d{1,2}:\d{2}.{0,3}[ap]\.\s?m\./);
  }
});

test('the Dashboard leads with what to do now, then capture, then context', async ({ page }) => {
  await richUser(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: /Radar/ })).toBeVisible();
  const h2 = await page.getByRole('heading', { level: 2 }).allInnerTexts();
  expect(h2.slice(0, 2)).toEqual(['¿Qué hago ahora?', 'Captura rápida']);
  expect(h2).toContain('Radar académico');
});

// ───────────────────────── Keyboard and focus ─────────────────────────

test('the first Tab stop is the skip link and it lands on the page content', async ({ page }) => {
  await richUser(page);
  await page.goto('/activities');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  // The next Tab continues INSIDE the content, not back in the navigation.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);
});

test('keyboard only: sign in, move around, create an activity, close dialogs, filter', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile === true, 'a touch viewport is not driven by a keyboard');
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Login with the keyboard alone.
  await page.getByLabel('Correo').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);

  // The navigation is reachable and activated with the keyboard.
  await page.getByRole('link', { name: 'Actividades' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/activities$/);

  // Open the form from its button, fill it, submit.
  const add = page.getByRole('button', { name: 'Agregar actividad' });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog.getByLabel('Título')).toBeFocused(); // focus moved inside
  await page.keyboard.type('Parcial por teclado');
  await dialog.getByLabel('Asignatura').selectOption({ label: 'Redes' });
  await dialog.getByLabel('Fecha').fill(bogotaToday(5));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'Parcial por teclado' })).toBeVisible();
  // Focus came back: to the opener, or to the page content when the opener was replaced by the list.
  expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);

  // Escape on a dialog without changes closes it at once and returns focus.
  await page.getByRole('button', { name: /^Editar Parcial por teclado/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Editar actividad' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar Parcial por teclado/ })).toBeFocused();

  // Filter chips are real buttons.
  await page.getByRole('button', { name: 'Pendientes' }).focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/status=PENDING/);
});

test('keyboard only: review and create the proposals of the Academic Inbox', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile === true, 'a touch viewport is not driven by a keyboard');
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  await addSubjectViaUi(page, 'Redes');
  await page.goto('/inbox');
  const box = page.getByLabel('Mensaje del profesor o instrucción académica');
  await box.focus();
  await page.keyboard.type('El viernes tendremos parcial de Redes a las 10am.');
  await page.getByRole('button', { name: 'Interpretar mensaje' }).focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('article').first();
  await expect(card).toBeVisible();
  await expect(page.getByRole('region', { name: /propuesta/ })).toBeFocused();
  const include = card.getByLabel(/Incluir/);
  await include.focus();
  if (!(await include.isChecked())) await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Crear seleccionadas' }).focus();
  await page.keyboard.press('Enter');
  await expect(card).toContainText('Actividad creada');
});

test('dialogs: focus goes in, comes back, and unsaved text is never lost by accident', async ({
  page,
}) => {
  await richUser(page);
  await page.goto('/subjects');
  const add = page.getByRole('button', { name: 'Agregar asignatura' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await expect(dialog.getByLabel('Nombre')).toBeFocused();

  // Untouched: a click on the backdrop closes at once and focus returns to the opener.
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  // Typed something: backdrop and Escape both ASK, nothing is lost, "Seguir editando" is the default.
  await add.click();
  await dialog.getByLabel('Nombre').fill('Álgebra lineal');
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Tienes cambios sin guardar');
  await expect(dialog.getByRole('button', { name: 'Seguir editando' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(dialog.getByLabel('Nombre')).toHaveValue('Álgebra lineal');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Descartar cambios' }).click();
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  // The explicit Cancel button is a clear decision: it closes without asking.
  await add.click();
  await dialog.getByLabel('Nombre').fill('Otra');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();

  // Deleting: Cancel is the focused, safe answer.
  await page.getByRole('button', { name: /^Eliminar Bases de Datos/ }).click();
  const confirm = page.getByRole('dialog', { name: /^¿Eliminar Bases de Datos/ });
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
});

test('a dialog taller than the screen scrolls inside itself and keeps its buttons reachable', async ({
  page,
}) => {
  await richUser(page);
  await page.setViewportSize({ width: 360, height: 420 });
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByText('Más opciones').click();
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420);
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Agregar', exact: true })).toBeInViewport();
  // The page behind does not scroll under the dialog.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
});

// ───────────────────────── Responsive ─────────────────────────

test('no horizontal overflow on any screen with long names and titles (current viewport)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await richUser(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
  await page.goto('/activities');
  await expect(page.getByText(LONG_TITLE)).toBeVisible();
  await page.goto('/subjects');
  await expect(page.getByText(LONG_SUBJECT)).toBeVisible();
});

for (const width of [320, 768]) {
  test(`reflow at ${width}px: every screen fits, with the navigation and a dialog`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await richUser(page);
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1024 });
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    }
    await page.goto('/activities');
    await page.getByRole('button', { name: 'Agregar actividad' }).click();
    await expectNoHorizontalOverflow(page);
  });
}

test('touch targets: buttons, selects and fields are at least 44 px tall on a phone', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile !== true, 'only meaningful on the phone viewport');
  test.setTimeout(120_000);
  await richUser(page);
  for (const route of ['/login', ...ROUTES]) {
    if (route === '/login') await page.context().clearCookies();
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const small = await page
      .locator(
        'button, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), summary',
      )
      .evaluateAll((els) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
          })
          .filter((e) => e.getBoundingClientRect().height < 43.5)
          .map(
            (e) =>
              `${e.tagName.toLowerCase()} "${(e.textContent || (e as HTMLInputElement).id || '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().height)}px`,
          ),
      );
    expect(small, `${route}: controls under 44 px`).toEqual([]);
    if (route === '/login') await login(page, 'nobody@example.com').catch(() => undefined);
  }
});

// ───────────────────────── Errors, sessions, offline ─────────────────────────

test('an unknown address shows a useful page, not a blank screen', async ({ page }) => {
  await richUser(page);
  await page.goto('/esto-no-existe');
  await expect(
    page.getByRole('heading', { level: 1, name: 'No encontramos esa página' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Volver al inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('when the session ends, the student is told so and sent to the login, once', async ({
  page,
  context,
}) => {
  const assertClean = watch(page, ['401 /api/*']);
  await richUser(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Let the Dashboard finish loading: a request still in flight when the cookie goes would be answered 401 and the app
  // would already be on the login before the click (the product is right; the test would not be testing the click).
  await page.waitForLoadState('networkidle');
  await context.clearCookies(); // the server no longer knows this session
  await page.getByRole('link', { name: 'Actividades' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText(
    'Tu sesión expiró. Inicia sesión nuevamente.',
  );
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  assertClean();
});

test('a failed refresh keeps the data on screen instead of replacing it with an error', async ({
  page,
}) => {
  await richUser(page);
  await page.goto('/activities');
  await expect(page.getByText('Parcial 1')).toBeVisible();
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(600);
  await expect(page.getByText('Parcial 1')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
  await page.context().setOffline(false);
});

test('a failed save keeps what the student typed and says what to do', async ({ page }) => {
  await richUser(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill('Entrega que no se debe perder');
  await dialog.getByLabel('Asignatura').selectOption({ index: 1 });
  await dialog.getByLabel('Fecha').fill(bogotaToday(9));
  await page.context().setOffline(true);
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/conectar|conexión/i);
  await expect(dialog.getByLabel('Título')).toHaveValue('Entrega que no se debe perder');
  await expect(dialog.getByRole('button', { name: 'Agregar', exact: true })).toBeEnabled();
  await page.context().setOffline(false);
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Entrega que no se debe perder')).toBeVisible();
});

test('the Academic Inbox keeps the pasted text when interpreting fails', async ({ page }) => {
  await richUser(page);
  await page.goto('/inbox');
  const box = page.getByLabel('Mensaje del profesor o instrucción académica');
  await box.fill('El viernes parcial de Redes.');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(box).toHaveValue('El viernes parcial de Redes.');
  await page.context().setOffline(false);
});

test('ten proposals of the Academic Inbox stay readable and inside the screen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await richUser(page);
  await page.goto('/inbox');
  const lines = Array.from(
    { length: 10 },
    (_, i) => `Parcial de Redes el ${String(20 + i).padStart(2, '0')}/11.`,
  );
  await page.getByLabel('Mensaje del profesor o instrucción académica').fill(lines.join('\n'));
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('article')).toHaveCount(10);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('heading', { level: 2, name: '10 propuestas' })).toBeVisible();
});
