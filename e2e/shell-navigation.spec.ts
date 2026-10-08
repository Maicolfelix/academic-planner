import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  login,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** UX1-1: the app shell. One main navigation: a bottom bar on a phone or tablet, part of the top bar from 1024 px up. */

const PHONE = (page: Page) => page.viewportSize()!.width < 1024;
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

async function signedIn(page: Page) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  return email;
}

test('the four daily destinations lead to their screens and mark the current one', async ({
  page,
}) => {
  const assertClean = watch(page);
  await signedIn(page);

  const nav = mainNav(page);
  await expect(nav.getByRole('link')).toHaveText([
    'Inicio',
    'Actividades',
    'Agenda',
    'Asignaturas',
  ]);

  const visit = async (name: string, url: RegExp, heading: string) => {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    // the current place is announced, and it is the only one
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  };

  await visit('Actividades', /\/activities$/, 'Actividades');
  await visit('Agenda', /\/calendar$/, 'Agenda');
  await visit('Asignaturas', /\/subjects$/, 'Mis asignaturas');
  await nav.getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(nav.getByRole('link', { name: 'Inicio', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  assertClean();
});

test('sign-out lives in the top bar, apart from the navigation, and works', async ({ page }) => {
  const assertClean = watch(page);
  const email = await signedIn(page);
  await page.waitForLoadState('networkidle');

  const banner = page.getByRole('banner');
  await expect(banner.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(mainNav(page).getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
  // the brand is text: it is not a second way home
  await expect(banner.getByText('Academic Planner')).toBeVisible();

  await banner.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  assertClean();
});

test('on a phone the bar is fixed to the bottom and the last content stays above it', async ({
  page,
}) => {
  test.skip(!PHONE(page), 'phone layout');
  await signedIn(page);
  const [subject] = await apiSubjects(page);
  for (let i = 1; i <= 8; i++) {
    await apiCreateActivity(page, {
      subjectId: subject!.id,
      title: `Actividad ${i}`,
      dueDate: daysFromNow(i),
    });
  }
  await page.goto('/activities');
  await expect(page.getByRole('heading', { level: 2, name: 'Actividad 8' })).toBeAttached();

  const viewport = page.viewportSize()!;
  const bar = async () => (await mainNav(page).boundingBox())!;
  let box = await bar();
  expect(box.y + box.height, 'bar bottom edge = screen bottom').toBeCloseTo(viewport.height, 0);
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height, 'bar is a comfortable target').toBeGreaterThanOrEqual(56);

  // the bar does not move while the page scrolls
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  box = await bar();
  expect(box.y + box.height).toBeCloseTo(viewport.height, 0);

  // at the very end the last card ends above the bar: nothing is hidden behind it
  const last = (await page.getByRole('listitem').filter({ hasText: 'Actividad 8' }).boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(box.y);
  await expectNoHorizontalOverflow(page);
});

test('a dialog covers the bar instead of fighting with it, and keeps its buttons reachable', async ({
  page,
}) => {
  test.skip(!PHONE(page), 'phone layout');
  await signedIn(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(dialog).toBeVisible();

  const save = dialog.getByRole('button', { name: 'Agregar', exact: true });
  await save.scrollIntoViewIfNeeded();
  const point = (await save.boundingBox())!;
  const topmostInsideDialog = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('dialog'),
    { x: point.x + point.width / 2, y: point.y + point.height / 2 },
  );
  expect(topmostInsideDialog).toBe(true);
  // and the bar is not what receives a tap that lands on the dialog
  const barBox = (await mainNav(page).boundingBox())!;
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
  expect(barBox.height).toBeGreaterThan(0);
});

test('on a wide screen the navigation sits in the top bar and the page keeps its reading column', async ({
  page,
}) => {
  test.skip(PHONE(page), 'desktop layout');
  await signedIn(page);
  await page.goto('/activities');

  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Principal' });
  await expect(nav).toBeVisible();
  const [navBox, mainBox, brandBox] = await Promise.all([
    nav.boundingBox(),
    page.locator('main').boundingBox(),
    page.getByRole('banner').getByText('Academic Planner').boundingBox(),
  ]);
  expect(navBox!.y + navBox!.height, 'above the content').toBeLessThanOrEqual(mainBox!.y);
  expect(navBox!.x, 'to the right of the brand').toBeGreaterThan(brandBox!.x + brandBox!.width);
  expect(mainBox!.width, 'a reading column, not the whole screen').toBeLessThanOrEqual(768);
  expect(navBox!.height, 'a slim bar').toBeLessThanOrEqual(64);
});

test('every destination is a 44 px target with a visible focus ring, reachable by keyboard', async ({
  page,
}) => {
  await signedIn(page);
  const links = mainNav(page).getByRole('link');
  for (const link of await links.all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }

  await page.goto('/dashboard');
  await page.keyboard.press('Tab'); // skip link
  let focused = '';
  for (let i = 0; i < 6 && focused !== 'Inicio'; i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focused.startsWith('Inicio')) focused = 'Inicio';
  }
  expect(focused).toBe('Inicio');
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
  expect(ring.style).not.toBe('none');
  expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
});

test('the shell passes axe on the home and activities screens', async ({ page }) => {
  await signedIn(page);
  for (const url of ['/dashboard', '/activities', '/calendar', '/subjects']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.length}`),
      url,
    ).toEqual([]);
  }
});

test('at 1024 px the top bar fits on one row, and at 768 px the bottom bar is used', async ({
  page,
}) => {
  test.skip(PHONE(page), 'desktop project (it sets its own width)');
  await signedIn(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/activities');
  const banner = page.getByRole('banner');
  const [bar, logout] = await Promise.all([
    banner.boundingBox(),
    banner.getByRole('button', { name: 'Cerrar sesión' }).boundingBox(),
  ]);
  expect(bar!.height, 'one row (a wrapped bar would be ~2x taller)').toBeLessThanOrEqual(72);
  expect(logout!.x + logout!.width).toBeLessThanOrEqual(1024);

  await page.setViewportSize({ width: 768, height: 1024 });
  const nav = (await mainNav(page).boundingBox())!;
  expect(nav.y + nav.height, 'tablet portrait: the bar is at the bottom').toBeCloseTo(1024, 0);
  await expectNoHorizontalOverflow(page);
});
