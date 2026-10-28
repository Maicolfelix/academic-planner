import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, uniqueEmail } from './helpers';

test.setTimeout(90_000);

// the companion's line is flavor, hidden from assistive technology on purpose: find it by its text
const says = (page: Page, text: string | RegExp) => page.getByText(text).first();

for (const path of ['/login', '/register']) {
  test(`${path}: one h1, the form is reachable, axe is clean and nothing overflows`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByLabel('Correo')).toBeVisible();
    await expect(page.getByRole('button', { name: /entrar|crear cuenta/i })).toBeVisible();
    // let the entrance finish (the page rises and the companion hops in) before measuring
    await page.waitForTimeout(1200);
    await expectNoHorizontalOverflow(page);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
      [],
    );
  });
}

test('the companion listens to the form: covers its eyes on the password, worries with an error', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(says(page, 'Hola otra vez. Qué bueno verte.')).toBeVisible();
  await page.getByLabel('Contraseña').focus();
  await expect(says(page, 'No miro, lo prometo.')).toBeVisible();
  await page.getByLabel('Correo').focus();
  await expect(says(page, 'Hola otra vez. Qué bueno verte.')).toBeVisible();

  await page.getByLabel('Correo').fill(uniqueEmail());
  await page.getByLabel('Contraseña').fill('una-clave-que-no-existe-1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); // the message is in the form, as text
  await expect(says(page, 'Tranquilo, lo revisamos juntos.')).toBeVisible();
});

test('on a phone the companion stands above the form and the form is not pushed off the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/register');
  await expect(page.getByLabel('Nombre')).toBeVisible();
  await page.waitForTimeout(1000);
  const submit = page.getByRole('button', { name: 'Crear cuenta' });
  await submit.scrollIntoViewIfNeeded();
  const box = (await submit.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('with reduced motion the sign-in scene is a still picture', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) =>
            a.playState === 'running' &&
            Number((a.effect as KeyframeEffect).getComputedTiming().duration) > 1,
        ).length,
  );
  expect(running).toBe(0);
  await context.close();
});

test('an address that does not exist shows the companion and a way back', async ({ page }) => {
  await page.goto('/esto-no-existe');
  await expect(
    page.getByRole('heading', { level: 1, name: 'No encontramos esa página' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
