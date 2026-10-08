import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  inBogota,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** UX1-2.5: motion and personality. Behavior is asserted by STATE (never by a sleep): positions after the move. */

const PHONE = (page: Page) => page.viewportSize()!.width < 1024;
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

async function seeded(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [redes] = await apiSubjects(page);
  const bio = await apiCreateSubject(page, 'Bioestadística');
  const soon = inBogota(12 * 3600e3);
  const ids: string[] = [];
  for (const a of [
    { subjectId: redes!.id, title: 'Entrega atrasada', dueDate: daysFromNow(-2) },
    { subjectId: bio.id, title: 'Taller', dueDate: daysFromNow(3) },
    { subjectId: bio.id, title: 'Lectura', dueDate: daysFromNow(6) },
    {
      subjectId: redes!.id,
      title: 'Parcial',
      type: 'EXAM' as const,
      dueDate: soon.dueDate,
      dueTime: soon.dueTime,
    },
  ])
    ids.push((await apiCreateActivity(page, a)).id);
  return { redes: redes!, bio, ids };
}

const centerX = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return box.x + box.width / 2;
};

test('the bottom bar mark slides to the destination you open and stays under its icon', async ({
  page,
}) => {
  test.skip(!PHONE(page), 'phone bar');
  const assertClean = watch(page);
  await seeded(page);
  await page.goto('/dashboard');

  const nav = mainNav(page);
  const indicator = nav.locator('[data-nav-indicator]');
  const places: [string, string][] = [
    ['Actividades', '1'],
    ['Agenda', '2'],
    ['Asignaturas', '3'],
    ['Inicio', '0'],
  ];
  for (const [name, index] of places) {
    const link = nav.getByRole('link', { name, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(indicator).toHaveAttribute('data-nav-indicator', index);
    // once the slide ends, the mark is centered under the link it belongs to (poll the state, not the clock)
    await expect
      .poll(
        async () =>
          Math.abs((await centerX(indicator.locator('span').last())) - (await centerX(link))),
        {
          timeout: 3000,
        },
      )
      .toBeLessThan(2);
  }
  assertClean();
});

test('the state filter is a segmented control: the highlight slides to the chosen state', async ({
  page,
}) => {
  const assertClean = watch(page);
  await seeded(page);
  await page.goto('/activities');

  const group = page.getByRole('group', { name: 'Estado' });
  const highlight = group.locator('span[aria-hidden="true"]');
  for (const label of ['Pendientes', 'Vencidas', 'Todas']) {
    const button = group.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { pressed: true })).toHaveCount(1);
    // the highlight ends exactly behind the pressed button (also when the track wraps onto a second row)
    await expect
      .poll(
        async () => {
          const [h, b] = [(await highlight.boundingBox())!, (await button.boundingBox())!];
          return Math.max(Math.abs(h.x - b.x), Math.abs(h.y - b.y), Math.abs(h.width - b.width));
        },
        { timeout: 3000 },
      )
      .toBeLessThan(2);
  }
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('marking an activity as finished confirms it for a moment, and nothing else changes', async ({
  page,
}) => {
  const assertClean = watch(page);
  await seeded(page);
  await page.goto('/activities');

  const card = page.getByRole('listitem').filter({ hasText: 'Taller' });
  await expect(card).toBeVisible();
  await expect(page.locator('[data-just-completed]')).toHaveCount(0); // not for activities already there

  await card.getByLabel('Cambiar estado de Taller').selectOption({ label: 'Finalizada' });
  const confirmed = page.locator('[data-just-completed]');
  await expect(confirmed).toHaveCount(1);
  await expect(confirmed).toContainText('Taller');
  await expect(confirmed).toContainText('Finalizada'); // the text says it: the tint is only a cue
  await expect(confirmed).toBeVisible(); // not blocked, not hidden
  // …and it fades back: the confirmation is a moment, not a state
  await expect(page.locator('[data-just-completed]')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'Taller' })).toContainText(
    'Finalizada',
  );
  assertClean();
});

test('the Agenda day selector answers with a springy highlight and keeps its semantics', async ({
  page,
}) => {
  test.skip(!PHONE(page), 'the day list is the phone view');
  await seeded(page);
  await page.goto('/calendar');

  const days = page.getByRole('group', { name: 'Días de la semana' }).getByRole('button');
  await expect(days).toHaveCount(7);
  const target = days.nth(4);
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(days.and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
  // the chosen day grows a little (the scale property), so it reads even without color
  await expect
    .poll(() => target.evaluate((el) => getComputedStyle(el).scale), { timeout: 3000 })
    .not.toBe('none');
  await expectNoHorizontalOverflow(page);
});

test('with reduced motion nothing slides, springs or waits, and everything is still in place', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seeded(page);

  // Home: the hero is there at once, with no animation time or delay left
  await page.goto('/dashboard');
  const hero = page.getByRole('region', { name: '¿Qué hago ahora?' }).getByRole('article');
  await expect(hero).toBeVisible();
  const heroMotion = await hero.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { duration: parseFloat(cs.animationDuration), delay: parseFloat(cs.animationDelay) };
  });
  expect(heroMotion.duration).toBeLessThan(0.001);
  expect(heroMotion.delay).toBe(0);
  // …and it is fully there as soon as the first frame has run (wait for that frame: a 0.01 ms animation still needs one)
  await expect(hero).toHaveCSS('opacity', '1');

  // the phone bar: the mark has no transition and is already under the current place
  if (PHONE(page)) {
    const indicator = mainNav(page).locator('[data-nav-indicator]');
    expect(
      await indicator.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
    ).toBeLessThan(0.001);
  }

  // the filter highlight jumps instead of sliding
  await page.goto('/activities');
  const group = page.getByRole('group', { name: 'Estado' });
  const highlight = group.locator('span[aria-hidden="true"]');
  await group.getByRole('button', { name: 'Pendientes', exact: true }).click();
  expect(
    await highlight.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
  ).toBeLessThan(0.001);
  await expect(group.getByRole('button', { name: 'Pendientes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Home, Activities and Agenda fit the screen and pass axe with all the new visuals', async ({
  page,
}) => {
  test.setTimeout(90_000); // seeds a semester, then three screens with axe: more than the default 30 s under load
  await seeded(page);
  for (const url of ['/dashboard', '/activities', '/calendar']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(900); // let the entrance finish: axe must read the final colors, not a fade
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      url,
    ).toEqual([]);
  }
});

/** UX1-2.75: intelligent ambient experience. Ambient motion exists, is never in step, and disappears with reduced motion. */

const animationOf = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).animationName);

test('the ambient light and the Radar rings are alive, and with reduced motion they never start', async ({
  page,
}) => {
  await seeded(page);
  await page.goto('/dashboard');
  const orbs = page.locator('.ambient-orb');
  await expect(orbs).toHaveCount(3);
  await expect(orbs.first()).toHaveCSS('animation-name', 'none'); // the background light is still on purpose (cost)
  const heroOrb = page
    .getByRole('region', { name: '¿Qué hago ahora?' })
    .locator('[class*="animate-drift"]');
  await expect(heroOrb).toHaveCSS('animation-name', 'drift'); // the hero's own light does drift
  const rings = page
    .getByRole('region', { name: 'Radar académico' })
    .locator('[class*="animate-halo"]');
  await expect(rings.first()).toBeAttached(); // the Radar loads after the Home
  expect(
    await rings.count(),
    'a ring for every category that has something to show',
  ).toBeGreaterThan(0);
  // out of step: the rings of different categories do not share a delay
  const delays = await rings.evaluateAll((els) =>
    els.map(
      (el) => getComputedStyle(el).animationDelay + '/' + getComputedStyle(el).animationDuration,
    ),
  );
  expect(new Set(delays).size, 'not synchronised').toBeGreaterThan(1);
  expect(await animationOf(rings.first())).toBe('halo');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  await expect(page.getByRole('region', { name: '¿Qué hago ahora?' })).toBeVisible();
  await expect(rings.first()).toBeAttached();
  for (const loop of [heroOrb, rings.first(), page.locator('[class*="animate-scan"]').first()])
    expect(await animationOf(loop)).toBe('none');
});

test('the ambient light follows the state of the semester, from data the Home already has', async ({
  page,
}) => {
  const { ids } = await seeded(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-ambient]')).toHaveAttribute('data-ambient', 'urgent'); // overdue + immediate

  // finish everything: the light turns to "done" (and the progress card takes its done tint)
  for (const id of ids)
    await page.request.patch(`/api/activities/${id}`, { data: { status: 'COMPLETED' } });
  await page.goto('/dashboard');
  await expect(page.locator('[data-ambient]')).toHaveAttribute('data-ambient', 'done');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
});

test('on a wide screen the navigation highlight slides to the current destination', async ({
  page,
}) => {
  test.skip(PHONE(page), 'desktop navigation');
  await seeded(page);
  await page.goto('/dashboard');
  const nav = mainNav(page);
  const pill = nav.locator('[data-nav-pill]');
  for (const name of ['Actividades', 'Agenda', 'Asignaturas', 'Inicio']) {
    const link = nav.getByRole('link', { name, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect
      .poll(
        async () => {
          const [p, l] = [(await pill.boundingBox())!, (await link.boundingBox())!];
          return Math.max(Math.abs(p.x - l.x), Math.abs(p.width - l.width), Math.abs(p.y - l.y));
        },
        { timeout: 3000 },
      )
      .toBeLessThan(2);
  }
});

test('the top of the page breathes on a wide screen: the greeting is not stuck to the bar', async ({
  page,
}) => {
  test.skip(PHONE(page), 'desktop spacing');
  await seeded(page);
  await page.goto('/dashboard');
  const bar = (await page.getByRole('banner').boundingBox())!;
  const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(
    title.y - (bar.y + bar.height),
    'air between the bar and the greeting',
  ).toBeGreaterThanOrEqual(32);
});
