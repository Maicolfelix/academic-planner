import { expect, test, type Page } from '@playwright/test';
import {
  apiCreateActivity,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
  addSubjectViaUi,
} from './helpers';

test.setTimeout(90_000);

const companion = (page: Page) => page.locator('[data-companion]');
const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await addSubjectViaUi(page, 'Redes');
}

const subjectId = async (page: Page) =>
  ((await (await page.request.get('/api/subjects')).json()).subjects as { id: string }[])[0]!.id;

async function activity(page: Page, title: string, dueInDays: number) {
  return apiCreateActivity(page, {
    subjectId: await subjectId(page),
    title,
    type: 'TASK',
    dueDate: bogotaToday(dueInDays),
  });
}

async function home(page: Page) {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(companion(page)).toBeVisible();
}

test('a calm student: planned ahead, nothing pressing', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page);
  await activity(page, 'Informe de laboratorio', 9);
  await home(page);
  await expect(companion(page)).toHaveAttribute('data-companion', 'CALM');
  await expect(companion(page).getByText('Todo en orden por ahora.')).toBeVisible();
  await expect(companion(page).getByText('Lo próximo es tu Informe de laboratorio.')).toBeVisible();
  await assertClean();
});

test('a quiet day: everything is done and nothing is coming up', async ({ page }) => {
  await newUser(page);
  const done = await activity(page, 'Taller entregado', 3);
  expect(
    (
      await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } })
    ).status(),
  ).toBe(200);
  await home(page);
  await expect(companion(page)).toHaveAttribute('data-companion', 'REST');
  await expect(companion(page).getByText('Hoy se ve tranquilo.')).toBeVisible();
});

test('one clear next step: focused, naming it', async ({ page }) => {
  await newUser(page);
  await activity(page, 'Quiz de Ciberseguridad', 0);
  await home(page);
  await expect(companion(page)).toHaveAttribute('data-companion', 'FOCUSED');
  await expect(companion(page).getByText('Una cosa a la vez.')).toBeVisible();
  await expect(companion(page).getByText('Lo próximo es tu Quiz de Ciberseguridad.')).toBeVisible();
});

test('several things close: busy, with no guilt and no extra pressure', async ({ page }) => {
  await newUser(page);
  await activity(page, 'Quiz uno', 0);
  await activity(page, 'Quiz dos', 0);
  await home(page);
  await expect(companion(page)).toHaveAttribute('data-companion', 'BUSY');
  const text = (await companion(page).innerText()).toLowerCase();
  expect(text).toContain('hay varias cosas cerca. vamos por partes.');
  expect(text).not.toMatch(/atrasad|debes|rápido|urgente|culpa|preocup|!/);
  expect(text).not.toContain('lo próximo'); // BUSY names nothing: the cards below do
});

test('a student with no subjects yet has no companion (the Home explains what to do)', async ({
  page,
}) => {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(companion(page)).toHaveCount(0);
});

for (const width of [360, 390, 768, 1366]) {
  test(`at ${width}px the companion fits, hides nothing and adds no scrolling`, async ({
    page,
  }) => {
    const assertClean = watch(page);
    await newUser(page);
    await activity(page, 'Quiz de redes', 0);
    await activity(page, 'Tarea de redes', 4);
    await page.setViewportSize({ width, height: 900 });
    await home(page);
    await expectNoHorizontalOverflow(page);

    const mine = (await companion(page).boundingBox())!;
    expect(mine.x).toBeGreaterThanOrEqual(0);
    expect(mine.x + mine.width).toBeLessThanOrEqual(width);
    expect(mine.height).toBeLessThan(width < 768 ? 140 : 200); // it never robs the phone of its height

    // Not sticky and not floating: it scrolls with the page and overlaps nothing.
    expect(await companion(page).evaluate((el) => getComputedStyle(el).position)).toBe('static');
    const quick = page.getByRole('region', { name: 'Captura rápida' });
    const radar = page.getByRole('region', { name: /Radar/ });
    for (const other of [quick, radar]) {
      if ((await other.count()) === 0) continue;
      const o = (await other.first().boundingBox())!;
      const apart =
        mine.y + mine.height <= o.y + 1 ||
        o.y + o.height <= mine.y + 1 ||
        mine.x + mine.width <= o.x + 1 ||
        o.x + o.width <= mine.x + 1;
      expect(apart, 'the companion overlaps another card').toBe(true);
    }
    await expect(quick).toBeVisible();
    await assertClean();
  });
}

test('with reduced motion the picture is still: no animation runs', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await newUser(page);
  await activity(page, 'Quiz', 0);
  await home(page);
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.effect && (a.effect as KeyframeEffect).target?.closest('[data-companion]'))
        .filter(
          (a) => a.playState === 'running' && Number(a.effect!.getComputedTiming().duration) > 1,
        ).length,
  );
  expect(running).toBe(0);
  await context.close();
});

test('with normal motion the animation exists but is tiny and the line is not hidden by it', async ({
  page,
}) => {
  await newUser(page);
  await activity(page, 'Quiz', 0);
  await home(page);
  // (the reduced-motion test above would mean nothing if nothing ever ran: here it does)
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('[data-companion]'))
        .length,
  );
  expect(running).toBeGreaterThan(0);
  const svg = companion(page).locator('svg');
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  await expect(svg).toHaveAttribute('focusable', 'false');
  expect(await companion(page).locator('button, a, [tabindex], [role]').count()).toBe(0);
  await expect(companion(page).getByText('Una cosa a la vez.')).toBeVisible();
});
