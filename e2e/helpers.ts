import { expect, type Page } from '@playwright/test';

export const uniqueEmail = () =>
  `ana+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
export const PASSWORD = 'correct horse battery';
export const NAME = 'Ana Pérez';

/**
 * Collects unexpected console errors, uncaught exceptions and failed API calls.
 * The only failures allowed are 401s from the auth endpoints (anonymous /me, wrong password)
 * plus whatever a test lists in `alsoExpected` (e.g. "409 /api/auth/register").
 */
export function watch(page: Page, alsoExpected: string[] = []) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedApi: string[] = [];

  page.on('console', (m) => {
    // Chrome logs every 4xx response as a console error; those are checked via `failedApi` instead.
    if (m.type() === 'error' && !/status of 40[19]/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith('/api/') || r.status() < 400) return;
    const expected = r.status() === 401 && /^\/api\/auth\/(me|login)$/.test(url.pathname);
    const label = `${r.status()} ${url.pathname}`;
    if (!expected && !alsoExpected.includes(label)) failedApi.push(label);
  });

  return () => {
    expect(pageErrors, 'uncaught exceptions').toEqual([]);
    expect(consoleErrors, 'console errors').toEqual([]);
    expect(failedApi, 'unexpected failed API calls').toEqual([]);
  };
}

export async function register(page: Page, email: string, name = NAME) {
  await page.goto('/register');
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** First-run screen: a new user must create an academic period before using the app. */
export async function completeOnboarding(page: Page, periodName = 'Segundo semestre 2026') {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Nombre del periodo').fill(periodName);
  await page.getByLabel('Inicio', { exact: true }).fill('2026-08-03');
  await page.getByLabel('Fin', { exact: true }).fill('2026-11-28');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/subjects$/);
}

/** A page must never scroll sideways, in any state (including with a dialog open). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}
