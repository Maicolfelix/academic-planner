import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  completeOnboarding,
  expectNoHorizontalOverflow,
  login,
  PASSWORD,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Onboarding P0-4a: right after the registration (not after a detour through the dashboard), one question per screen —
 * what the app is for, then the current period — always skippable, saved on the server as it goes and resumable. Nobody is
 * sent here because their profile is incomplete: only the missing period does that, as before.
 */

const QUESTION = '¿Para qué quieres usar Academic Planner?';
const profile = async (page: Page) =>
  (await (await page.request.get('/api/profile')).json()).profile as {
    primaryUse: string | null;
    onboardingStatus: string;
  };
const periods = async (page: Page) =>
  (await (await page.request.get('/api/periods')).json()).periods as {
    id: string;
    isCurrent: boolean;
  }[];
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const fillPeriod = async (page: Page, start = '2026-08-03', end = '2026-11-28') => {
  await page.getByLabel('Inicio', { exact: true }).fill(start);
  await page.getByLabel('Fin', { exact: true }).fill(end);
  await page.getByRole('button', { name: 'Continuar' }).click();
};

const USES: [title: string, value: string, heading: string][] = [
  ['Universidad', 'UNIVERSITY_STUDENT', 'Tu semestre actual'],
  ['Colegio', 'SCHOOL_STUDENT', 'Tu periodo escolar'],
  ['Soy docente', 'TEACHER', 'Tu periodo actual'],
  ['Otro tipo de estudio', 'OTHER_STUDENT', 'Tu periodo de estudio'],
  ['Organización personal', 'PERSONAL', 'Tu planificación actual'],
];

test('registering goes straight to the onboarding, with one question and the five options', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(h1(page, QUESTION)).toBeVisible();
  for (const [title] of USES)
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Omitir por ahora' })).toBeVisible();
  // nothing is saved until the student answers
  expect(await profile(page)).toEqual({
    primaryUse: null,
    programName: null,
    programKey: null,
    onboardingStatus: 'NOT_STARTED',
  });
  expect(await periods(page)).toEqual([]);
  assertClean();
});

for (const [title, value, heading] of USES) {
  test(`choosing "${title}" saves it, changes the words of the period step and ends in the subjects`, async ({
    page,
  }) => {
    const assertClean = watch(page);
    await register(page, uniqueEmail());
    await expect(h1(page, QUESTION)).toBeVisible(); // loaded: only then does the connection go away
    await page.getByRole('button', { name: new RegExp(title) }).click();

    await expect(h1(page, heading)).toBeVisible();
    expect(await profile(page)).toMatchObject({
      primaryUse: value,
      onboardingStatus: 'IN_PROGRESS',
    });
    // the name is offered, the dates are never guessed
    const name = page.getByLabel('Nombre del periodo');
    if (value === 'PERSONAL') await expect(name).toHaveValue('Mi planificación');
    else await expect(name).toHaveValue(/semestre \d{4}$/);
    await expect(page.getByLabel('Inicio', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Fin', { exact: true })).toHaveValue('');

    await fillPeriod(page);
    await expect(page).toHaveURL(/\/subjects$/);
    // the status stays IN_PROGRESS on purpose (more steps are coming); the app is usable
    expect(await profile(page)).toMatchObject({
      primaryUse: value,
      onboardingStatus: 'IN_PROGRESS',
    });
    const created = await periods(page);
    expect(created).toHaveLength(1);
    expect(created[0]!.isCurrent).toBe(true);
    assertClean();
  });
}

test('skipping saves SKIPPED and goes straight to the period, which is still required', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await page.getByRole('button', { name: 'Omitir por ahora' }).click();
  await expect(h1(page, 'Tu periodo actual')).toBeVisible();
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'SKIPPED' });
  await page.goto('/dashboard'); // not allowed through without a period
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(h1(page, 'Tu periodo actual')).toBeVisible(); // and it does not ask the question again
  await fillPeriod(page);
  await expect(page).toHaveURL(/\/subjects$/);
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'SKIPPED' });
  assertClean();
});

test('closing the page after the first answer and coming back continues at the period', async ({
  page,
  context,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await page.getByRole('button', { name: /Colegio/ }).click();
  await expect(h1(page, 'Tu periodo escolar')).toBeVisible();

  await page.reload();
  await expect(h1(page, 'Tu periodo escolar')).toBeVisible(); // not asked again, same words

  const again = await context.newPage(); // "another visit": a brand new page of the same session
  await again.goto('/dashboard');
  await expect(again).toHaveURL(/\/onboarding$/);
  await expect(h1(again, 'Tu periodo escolar')).toBeVisible();
  await again.close();
  assertClean();
});

test.describe('when saving fails', () => {
  test.use({ serviceWorkers: 'block' });

  test('the choice stays marked, the error says what to do, and tapping again goes on', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await register(page, uniqueEmail());

    await page.route('**/api/profile', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            json: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
          })
        : route.continue(),
    );
    const option = page.getByRole('button', { name: /Universidad/ });
    await option.click();
    await expect(page.getByRole('alert')).toContainText(
      'Toca una opción para intentarlo de nuevo.',
    );
    await expect(option).toHaveAttribute('aria-pressed', 'true'); // nothing seems lost
    await expect(h1(page, QUESTION)).toBeVisible();
    expect((await profile(page)).primaryUse).toBeNull(); // and nothing was saved

    await page.unroute('**/api/profile');
    await option.click();
    await expect(h1(page, 'Tu semestre actual')).toBeVisible();
    expect((await profile(page)).primaryUse).toBe('UNIVERSITY_STUDENT');
    expect(pageErrors).toEqual([]);
  });

  test('without a connection the answer says so (and the period step too)', async ({
    page,
    context,
  }) => {
    await register(page, uniqueEmail());
    await expect(h1(page, QUESTION)).toBeVisible(); // loaded: only then does the connection go away
    await context.setOffline(true);
    await page.getByRole('button', { name: /Colegio/ }).click();
    await expect(page.getByRole('alert')).toContainText(/conexi/i);
    await context.setOffline(false);
    await page.getByRole('button', { name: /Colegio/ }).click();
    await expect(h1(page, 'Tu periodo escolar')).toBeVisible();

    await page.getByLabel('Inicio', { exact: true }).fill('2026-08-03');
    await page.getByLabel('Fin', { exact: true }).fill('2026-11-28');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('alert')).toContainText(/conexi/i);
    await expect(page.getByLabel('Inicio', { exact: true })).toHaveValue('2026-08-03'); // what was typed stays
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\/subjects$/);
  });
});

test('a student who already has a period is NOT sent to the onboarding when logging in', async ({
  page,
}) => {
  const assertClean = watch(page);
  const email = uniqueEmail();
  await register(page, email);
  await expect(page).toHaveURL(/\/onboarding$/); // the session cookie is set before the test uses it
  // an existing account: a period, and a profile that was never touched (NOT_STARTED, no primary use)
  const res = await page.request.post('/api/periods', {
    data: { name: 'Periodo existente', startDate: '2026-08-03', endDate: '2026-11-28' },
  });
  expect(res.status()).toBe(201);
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'NOT_STARTED' });
  await page.request.post('/api/auth/logout');

  await page.goto('/login');
  await login(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/calendar$/); // the app works as always
  assertClean();
});

test('an existing student can open the onboarding by hand: the question, without recreating the period', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page); // skips the question, creates the period
  const before = await periods(page);

  await page.goto('/onboarding');
  await expect(h1(page, QUESTION)).toBeVisible();
  await expect(page.getByLabel('Nombre del periodo')).toHaveCount(0);
  await page.getByRole('button', { name: /Universidad/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await profile(page)).toMatchObject({
    primaryUse: 'UNIVERSITY_STUDENT',
    onboardingStatus: 'IN_PROGRESS',
  });
  expect(await periods(page)).toEqual(before); // not one period was created or changed

  await page.goto('/onboarding'); // answered: nothing left to ask
  await expect(page).toHaveURL(/\/dashboard$/);
  assertClean();
});

test('the demo-style empty profile still works: the app opens, and the onboarding can be answered later', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await profile(page)).toMatchObject({ primaryUse: null, onboardingStatus: 'SKIPPED' });
  assertClean();
});

test('keyboard: the options are reachable with Tab and chosen with Enter or Space, with a visible focus', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(h1(page, QUESTION)).toBeVisible();
  const first = page.getByRole('button', { name: /Universidad/ });
  await page.keyboard.press('Tab'); // the first stop of the page is the first option
  await expect(first).toBeFocused();
  const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Colegio/ })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(h1(page, 'Tu periodo escolar')).toBeVisible();
  expect((await profile(page)).primaryUse).toBe('SCHOOL_STUDENT');
  assertClean();
});

test('both steps fit every width, with 44 px targets, a single h1 and no axe violations', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/); // the session cookie is set before navigating by hand
  const axe = async (label: string) => {
    await page.waitForTimeout(700); // the entrances finish: axe must read the final colors
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      label,
    ).toEqual([]);
  };
  const smallTargets = (p: Page) =>
    p.locator('button, input, a, select').evaluateAll((els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height < 43.5;
        })
        .map((el) => `${el.tagName} ${el.textContent?.slice(0, 24) ?? ''}`),
    );

  for (const width of [320, 360, 390, 430, 768, 1366]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/onboarding');
    await expect(h1(page, QUESTION)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    expect(await smallTargets(page), `step 1 targets at ${width}`).toEqual([]);
    await axe(`step 1 at ${width}`);
  }

  await page.getByRole('button', { name: /Universidad/ }).click();
  await expect(h1(page, 'Tu semestre actual')).toBeVisible();
  for (const width of [320, 360, 390, 430, 768, 1366]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await smallTargets(page), `step 2 targets at ${width}`).toEqual([]);
    await axe(`step 2 at ${width}`);
  }
  assertClean();
});
