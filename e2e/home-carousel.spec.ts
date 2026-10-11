import AxeBuilder from '@axe-core/playwright';
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
} from './helpers';

/** The Home hero: up to five next activities by deadline, a snapping strip with dots that are real buttons. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const hero = (page: Page) => page.getByRole('region', { name: '¿Qué hago ahora?' });
const slides = (page: Page) => hero(page).locator('[aria-roledescription="actividad"]');
const onScreen = (page: Page) =>
  hero(page).locator('[aria-roledescription="actividad"]:not([inert])');
const titlesOf = (page: Page) => slides(page).locator('p[id^="attention-activity-"]');
const dots = (page: Page) => hero(page).getByRole('button', { name: /^Ver actividad \d+ de \d+$/ });
const strip = (page: Page) => hero(page).getByRole('group', { name: 'Próximas actividades' });

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  return (await apiSubjects(page))[0]!;
}

async function make(page: Page, subjectId: string, title: string, offsetMs: number) {
  return apiCreateActivity(page, { subjectId, title, type: 'TASK', ...inBogota(offsetMs) });
}

/** The strip is at slide `index` (its scroll position, not just the state). */
const scrolledTo = (page: Page, index: number) =>
  expect
    .poll(() => strip(page).evaluate((el) => Math.round(el.scrollLeft / el.clientWidth)))
    .toBe(index);

test('up to five activities by deadline, soonest first, whatever their priority; the rest stay out', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const titles = ['Séptima', 'Primera', 'Cuarta', 'Segunda', 'Sexta', 'Tercera', 'Quinta'];
  const offsets = [7, 1, 4, 2, 6, 3, 5];
  for (const [i, t] of titles.entries()) {
    await apiCreateActivity(page, {
      subjectId: redes.id,
      title: t,
      type: 'TASK',
      priority: i === 0 ? 'HIGH' : 'LOW',
      ...inBogota(offsets[i]! * DAY),
    });
  }

  await page.goto('/dashboard');
  await expect(slides(page)).toHaveCount(5);
  await expect(titlesOf(page)).toHaveText(['Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta']);
  await expect(dots(page)).toHaveCount(5);
  await expect(onScreen(page)).toHaveCount(1);
  await expect(onScreen(page).getByRole('article', { name: 'Primera' })).toBeVisible();
  await expect(hero(page)).not.toContainText('Séptima');
  assertClean();
});

test('the dots are buttons: named, current, clickable and driven by the keyboard', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  for (const [i, t] of ['Uno', 'Dos', 'Tres', 'Cuatro'].entries())
    await make(page, redes.id, t, (i + 1) * DAY);

  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(4);
  for (const n of [1, 2, 3, 4])
    await expect(hero(page).getByRole('button', { name: `Ver actividad ${n} de 4` })).toBeVisible();
  await expect(dots(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(dots(page).nth(1)).toHaveAttribute('aria-current', 'false');

  // Click: that activity is on screen, the strip is at its slide, and only its dot is current.
  await hero(page).getByRole('button', { name: 'Ver actividad 3 de 4' }).click();
  await expect(onScreen(page).getByRole('article', { name: 'Tres' })).toBeVisible();
  await expect(dots(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(dots(page).nth(0)).toHaveAttribute('aria-current', 'false');
  await scrolledTo(page, 2);

  // Keyboard: Tab reaches a dot, arrows move through them (focus follows), Home/End jump.
  await dots(page).nth(2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dots(page).nth(3)).toBeFocused();
  await expect(onScreen(page).getByRole('article', { name: 'Cuatro' })).toBeVisible();
  await page.keyboard.press('ArrowRight'); // the last one: stays
  await expect(dots(page).nth(3)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(dots(page).nth(0)).toBeFocused();
  await expect(onScreen(page).getByRole('article', { name: 'Uno' })).toBeVisible();
  await scrolledTo(page, 0);
  await page.keyboard.press('End');
  await expect(onScreen(page).getByRole('article', { name: 'Cuatro' })).toBeVisible();

  // The slide on screen is the only one in the tab order; the dots are part of it.
  await expect(onScreen(page).getByRole('link', { name: /Ver actividad: Cuatro/ })).toBeVisible();
  await expect(onScreen(page).getByRole('link')).toHaveCount(1);
  await expect(hero(page).locator('[inert]')).toHaveCount(3);
  assertClean();
});

test('a single activity is just the hero (no dots), and none at all is the calm empty state', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const done = await make(page, redes.id, 'Hecha', DAY);
  expect(
    (
      await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } })
    ).ok(),
  ).toBe(true);
  await page.goto('/dashboard');
  await expect(hero(page)).toContainText('No tienes actividades pendientes en este momento.');
  await expect(dots(page)).toHaveCount(0);

  await make(page, redes.id, 'Única', 2 * DAY);
  await page.goto('/dashboard');
  await expect(slides(page)).toHaveCount(1);
  await expect(dots(page)).toHaveCount(0);
  await expect(onScreen(page).getByRole('article', { name: 'Única' })).toBeVisible();
  assertClean();
});

test('it follows the data: finishing, deleting, a new nearer one and a moved deadline reorder it', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const a = await make(page, redes.id, 'A', 1 * DAY);
  const b = await make(page, redes.id, 'B', 2 * DAY);
  await make(page, redes.id, 'C', 3 * DAY);
  await page.goto('/dashboard');
  await expect(slides(page)).toHaveCount(3);

  // finish the first: it leaves, the second takes its place
  expect(
    (
      await page.request.patch(`/api/activities/${a.id}`, { data: { status: 'COMPLETED' } })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(slides(page)).toHaveCount(2);
  await expect(onScreen(page).getByRole('article', { name: 'B' })).toBeVisible();
  await expect(dots(page)).toHaveCount(2);

  // a new one that is nearer goes first
  const d = await make(page, redes.id, 'D', 12 * HOUR);
  await page.reload();
  await expect(slides(page)).toHaveCount(3);
  await expect(onScreen(page).getByRole('article', { name: 'D' })).toBeVisible();

  // move B's deadline after C's: the order follows the deadline
  const moved = inBogota(5 * DAY);
  expect((await page.request.patch(`/api/activities/${b.id}`, { data: moved })).status()).toBe(200);
  await page.reload();
  await expect(titlesOf(page)).toHaveText(['D', 'C', 'B']);

  // delete the first: C is on screen with two dots
  expect((await page.request.delete(`/api/activities/${d.id}`)).ok()).toBe(true);
  await page.reload();
  await expect(onScreen(page).getByRole('article', { name: 'C' })).toBeVisible();
  await expect(dots(page)).toHaveCount(2);
  assertClean();
});

test('the strip snaps, a swipe moves the current dot, and a dot moves the strip', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  for (const [i, t] of ['Uno', 'Dos', 'Tres'].entries())
    await make(page, redes.id, t, (i + 1) * DAY);
  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(3);

  await expect(strip(page)).toHaveCSS('scroll-snap-type', 'x mandatory');
  // A swipe is a scroll of the strip: the current dot and the slide on screen follow it.
  await strip(page).evaluate((el) =>
    el.scrollTo({ left: el.clientWidth * 2, behavior: 'instant' }),
  );
  await expect(dots(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(onScreen(page).getByRole('article', { name: 'Tres' })).toBeVisible();
  await strip(page).evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'instant' }));
  await expect(dots(page).nth(1)).toHaveAttribute('aria-current', 'true');
  // ...and a dot moves the strip back (and the state does not bounce while it travels)
  await dots(page).nth(0).click();
  await scrolledTo(page, 0);
  await expect(dots(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(dots(page).nth(1)).toHaveAttribute('aria-current', 'false');
  assertClean();
});

test('with reduced motion a dot jumps at once (no smooth scroll)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const redes = await newUser(page);
  for (const [i, t] of ['Uno', 'Dos', 'Tres'].entries())
    await make(page, redes.id, t, (i + 1) * DAY);
  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(3);
  await dots(page).nth(2).click();
  await scrolledTo(page, 2);
  await expect(onScreen(page).getByRole('article', { name: 'Tres' })).toBeVisible();
});

for (const width of [320, 390, 430, 768, 1366]) {
  test(`${width} px: no overflow, dots are comfortable targets, long titles fit and axe passes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const redes = await newUser(page);
    const long = `Entrega ${'muy larga '.repeat(6)}Supercalifragilisticoespialidosoynadamás`;
    await make(page, redes.id, long, 1 * DAY);
    for (const [i, t] of ['Dos', 'Tres', 'Cuatro', 'Cinco'].entries())
      await make(page, redes.id, t, (i + 2) * DAY);
    await page.goto('/dashboard');
    await expect(dots(page)).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
    for (const dot of await dots(page).all()) {
      const box = (await dot.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const card = (await onScreen(page).getByRole('article').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(width);

    await dots(page).nth(3).click();
    await scrolledTo(page, 3);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(700); // let the entrances finish: axe must read the final colors
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
