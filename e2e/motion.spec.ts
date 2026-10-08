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
  await apiCreateActivity(page, {
    subjectId: redes!.id,
    title: 'Entrega atrasada',
    dueDate: daysFromNow(-2),
  });
  await apiCreateActivity(page, { subjectId: bio.id, title: 'Taller', dueDate: daysFromNow(3) });
  await apiCreateActivity(page, { subjectId: bio.id, title: 'Lectura', dueDate: daysFromNow(6) });
  const soon = inBogota(12 * 3600e3);
  await apiCreateActivity(page, {
    subjectId: redes!.id,
    title: 'Parcial',
    type: 'EXAM',
    dueDate: soon.dueDate,
    dueTime: soon.dueTime,
  });
  return { redes: redes!, bio };
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
        async () => Math.abs((await centerX(indicator.locator('span'))) - (await centerX(link))),
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
    return {
      duration: parseFloat(cs.animationDuration),
      delay: parseFloat(cs.animationDelay),
      opacity: cs.opacity,
    };
  });
  expect(heroMotion.duration).toBeLessThan(0.001);
  expect(heroMotion.delay).toBe(0);
  expect(heroMotion.opacity).toBe('1');

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
