import { expect, test, type Page, type Route } from '@playwright/test';
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
} from './helpers';

/**
 * P9-1: the "¿Qué hago ahora?" hero is actionable: Completar / Empezar change the status through the same mutation as the
 * Activities screen and the Home recalculates by itself. `page.route` needs the service worker out of the way.
 */
test.use({ serviceWorkers: 'block' });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const attention = (page: Page) => page.getByRole('region', { name: '¿Qué hago ahora?' });
const current = (page: Page) =>
  attention(page).locator('[aria-roledescription="actividad"]:not([inert])');
const recommended = (page: Page, title: string) =>
  expect(current(page).getByRole('article', { name: title })).toBeVisible();
const patchesOnly = (route: Route) => route.request().method() === 'PATCH';

async function twoActivities(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [subject] = await apiSubjects(page);
  for (const [title, offset] of [
    ['Primera', 5 * HOUR],
    ['Segunda', 2 * DAY],
  ] as const)
    await apiCreateActivity(page, {
      subjectId: subject!.id,
      title,
      type: 'TASK',
      ...inBogota(offset),
    });
  await page.goto('/dashboard');
  await recommended(page, 'Primera');
}

test('Completar from the hero: the activity is completed and the next one is recommended without reloading', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoActivities(page);
  await page.evaluate(() => ((window as unknown as { __kept?: number }).__kept = 1));

  await current(page).getByRole('button', { name: 'Completar: Primera' }).click();

  await recommended(page, 'Segunda');
  await expect(attention(page).getByRole('article', { name: 'Primera' })).toHaveCount(0);
  await expect(attention(page).getByRole('status').first()).toHaveText('«Primera» completada.');
  // the keyboard stays in the section (the finished hero is gone)
  await expect(attention(page).getByRole('heading', { level: 2 })).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as { __kept?: number }).__kept === 1),
    'no reload',
  ).toBe(true);

  // the same change the Activities screen shows
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Actividades' })
    .click();
  await expect(page.getByLabel('Cambiar estado de Primera')).toHaveValue('COMPLETED');
  assertClean();
});

test('Empezar: the activity goes in progress, stays recommended and no longer offers Empezar', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoActivities(page);

  await current(page).getByRole('button', { name: 'Empezar: Primera' }).click();

  await expect(current(page).getByText('Ya comenzaste esta actividad.')).toBeVisible();
  await recommended(page, 'Primera');
  await expect(current(page).getByText('En proceso')).toBeVisible();
  await expect(current(page).getByRole('button', { name: 'Empezar: Primera' })).toHaveCount(0);
  await expect(current(page).getByRole('button', { name: 'Completar: Primera' })).toBeEnabled();
  assertClean();
});

test('a failed change shows an error, no false success, and the action is enabled again', async ({
  page,
}) => {
  // `watch` lets some 4xx console lines pass but not a 500: this test provokes exactly one, so it listens by itself.
  const unexpected: string[] = [];
  page.on('pageerror', (e) => unexpected.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (40[019]|500)/.test(m.text()))
      unexpected.push(m.text());
  });
  await twoActivities(page);
  const failing = (route: Route) =>
    patchesOnly(route)
      ? route.fulfill({
          status: 500,
          json: { error: { code: 'INTERNAL', message: 'Error interno.' } },
        })
      : route.fallback();
  await page.route('**/api/activities/*', failing);

  const complete = current(page).getByRole('button', { name: 'Completar: Primera' });
  await complete.click();
  await expect(current(page).getByRole('alert')).toContainText('No se pudo guardar el cambio');
  await expect(attention(page).getByRole('status').first()).toHaveText('');
  await recommended(page, 'Primera');
  await expect(complete).toBeEnabled();

  // the retry works and clears the error
  await page.unroute('**/api/activities/*', failing);
  await complete.click();
  await recommended(page, 'Segunda');
  await expect(attention(page).getByRole('alert')).toHaveCount(0);
  expect(unexpected, 'only the provoked 500 was logged').toEqual([]);
});

test('one tap is one request: the buttons wait while the change is saved', async ({ page }) => {
  const assertClean = watch(page);
  await twoActivities(page);
  let patches = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/activities/*', async (route) => {
    if (!patchesOnly(route)) return route.fallback();
    patches += 1;
    await gate;
    return route.fallback();
  });

  const complete = current(page).getByRole('button', { name: 'Completar: Primera' });
  await complete.click();
  await expect(complete).toBeDisabled();
  await expect(complete).toHaveText('Completando…');
  await expect(current(page).getByRole('button', { name: 'Empezar: Primera' })).toBeDisabled();
  release();
  await recommended(page, 'Segunda');
  expect(patches).toBe(1);
  assertClean();
});

for (const [name, size] of [
  ['360', { width: 360, height: 740 }],
  ['1366', { width: 1366, height: 800 }],
] as const) {
  test(`the hero with actions stays clean at ${name} px`, async ({ page }) => {
    await page.setViewportSize(size);
    await twoActivities(page);
    await expectNoHorizontalOverflow(page);
    for (const [role, label] of [
      ['button', 'Completar: Primera'],
      ['button', 'Empezar: Primera'],
      ['link', 'Ver actividad: Primera'],
    ] as const) {
      const box = (await current(page).getByRole(role, { name: label }).boundingBox())!;
      expect(box.height, label).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, label).toBeLessThanOrEqual(size.width);
    }
  });
}
