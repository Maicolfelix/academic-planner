import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

test.setTimeout(90_000);

const layer = (page: Page) => page.locator('[data-companion-layer]');
const mate = (page: Page) => page.getByRole('button', { name: /tu compañero/i });
const bubble = (page: Page) => layer(page).getByRole('status');

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  await addSubjectViaUi(page, 'Redes');
}

const subjectId = async (page: Page) =>
  ((await (await page.request.get('/api/subjects')).json()).subjects as { id: string }[])[0]!.id;

// the lane is a CSS-transformed box: its x is the translateX of its first child
const laneX = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-companion-layer] > div') as HTMLElement | null;
    return el ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 : null;
  });

test('it lives on the app screens, greets once, and the Home keeps its own card', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.evaluate(() => sessionStorage.clear()); // setting the account up already counted as the visit's greeting
  await page.goto('/activities');
  await expect(mate(page)).toBeVisible();
  await expect(bubble(page)).toContainText('Aquí estoy'); // a greeting by the time of day
  await expect(bubble(page)).toBeHidden({ timeout: 8000 }); // it goes away by itself
  await page.goto('/calendar');
  await expect(mate(page)).toBeVisible();
  await expect(bubble(page)).toHaveCount(0); // once per visit
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(layer(page)).toHaveCount(0);
  await assertClean();
});

test('only the character catches taps: the lane lets everything else through', async ({ page }) => {
  await newUser(page);
  await page.goto('/activities');
  await expect(mate(page)).toBeVisible();
  expect(await layer(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await mate(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
  const box = (await mate(page).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
});

test('a touch is answered, and the student can hide it and bring it back from the Home', async ({
  page,
}) => {
  await newUser(page);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/activities');
  await expect(bubble(page)).toContainText('Aquí estoy');
  await expect(bubble(page)).toBeHidden({ timeout: 8000 });
  await mate(page).click();
  await expect(bubble(page)).toBeVisible();
  await bubble(page).getByRole('button', { name: 'Ocultar compañero' }).click();
  await expect(layer(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(layer(page)).toHaveCount(0); // remembered on this device

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Que mi compañero me acompañe por la app' }).click();
  await expect(
    page.getByRole('button', { name: 'Que mi compañero me acompañe por la app' }),
  ).toHaveCount(0);
  await page.goto('/activities');
  await expect(mate(page)).toBeVisible();
});

test('it steps out of the way while the student types and comes back', async ({ page }) => {
  await newUser(page);
  await page.goto('/activities');
  await expect(mate(page)).toBeVisible();
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'tmp-field';
    document.body.appendChild(input);
    input.focus();
  });
  await expect(layer(page)).toHaveCount(0);
  await page.evaluate(() => (document.getElementById('tmp-field') as HTMLInputElement).blur());
  await expect(mate(page)).toBeVisible({ timeout: 4000 });
});

test('it notices a finished activity', async ({ page }) => {
  await newUser(page);
  await apiCreateActivity(page, {
    subjectId: await subjectId(page),
    title: 'Taller de redes',
    type: 'TASK',
    dueDate: bogotaToday(2),
  });
  await page.goto('/activities');
  await expect(bubble(page)).toContainText('Aquí estoy'); // the greeting comes a beat after the page
  await expect(bubble(page)).toBeHidden({ timeout: 8000 }); // let it pass
  const card = page.getByRole('listitem').filter({ hasText: 'Taller de redes' });
  await card.getByLabel('Cambiar estado de Taller de redes').selectOption({ label: 'Finalizada' });
  await expect(bubble(page)).toContainText(/menos|ya está/i);
});

test('it walks to another spot now and then, and with reduced motion it stays put', async ({
  browser,
}) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await newUser(page);
    await page.clock.install();
    await page.goto('/activities');
    await expect(mate(page)).toBeVisible();
    const before = await laneX(page);
    await page.clock.runFor(60_000);
    const after = await laneX(page);
    if (reducedMotion === 'reduce') expect(after).toBe(before);
    else expect(after).not.toBe(before);
    await context.close();
  }
});

test('with reduced motion nothing in the layer is animated', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await newUser(page);
  await page.goto('/activities');
  await expect(mate(page)).toBeVisible();
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) =>
            (a.effect as KeyframeEffect | null)?.target?.closest('[data-companion-layer]') &&
            a.playState === 'running' &&
            Number(a.effect!.getComputedTiming().duration) > 1,
        ).length,
  );
  expect(running).toBe(0);
  await context.close();
});
