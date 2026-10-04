import { expect, test } from '@playwright/test';
import {
  completeOnboarding,
  greetingFor,
  login,
  NAME,
  register,
  uniqueEmail,
  watch,
} from './helpers';

test('full auth flow: register, persist, logout, guard, login, wrong credentials', async ({
  page,
  context,
}) => {
  const assertClean = watch(page);
  const email = uniqueEmail();

  // 1-4. Register -> a user without an academic period is sent to onboarding first (Phase 3),
  // then reaches the protected screen showing their name.
  await register(page, email);
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: greetingFor(NAME) })).toBeVisible();
  await expect(page.getByText('Segundo semestre 2026')).toBeVisible();

  // The session cookie is HttpOnly (invisible to JS) and nothing is kept in web storage.
  const cookie = (await context.cookies()).find((c) => c.name === 'academic_planner_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('academic_planner_session');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  // 5-6. Refresh: still authenticated.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: greetingFor(NAME) })).toBeVisible();

  // Authenticated users are bounced away from /login and /register.
  await page.goto('/login');
  await expect(page).toHaveURL(/\/dashboard$/);

  // 7. Logout -> login screen with confirmation.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Sesión cerrada correctamente.');

  // 8-9. Protected route without a session -> login.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  // 10-11. Log in again.
  await login(page, email.toUpperCase());
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: greetingFor(NAME) })).toBeVisible();

  // Back button after logout must not reveal the protected screen.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);

  // 12-13. Wrong credentials: understandable generic message, stays on /login.
  await page.goto('/login');
  await login(page, email, 'definitely-wrong');
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();

  assertClean();
});

test('register shows client-side validation without calling the API', async ({ page }) => {
  const assertClean = watch(page);
  const registerCalls: string[] = [];
  page.on('request', (r) => r.url().includes('/api/auth/register') && registerCalls.push(r.url()));

  await page.goto('/register');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByText('Ingresa tu nombre.')).toBeVisible();
  await expect(page.getByText('Ingresa un correo válido.')).toBeVisible();
  await expect(page.getByText('La contraseña debe tener al menos 8 caracteres.')).toBeVisible();
  await expect(page.getByLabel('Correo')).toHaveAttribute('aria-invalid', 'true');
  expect(registerCalls).toEqual([]);

  assertClean();
});

test('registering an existing email shows a clear error', async ({ page, context }) => {
  const assertClean = watch(page, ['409 /api/auth/register']);
  const email = uniqueEmail();

  await register(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await context.clearCookies(); // simulate another browser

  await register(page, email);
  await expect(page.getByText('Ya existe una cuenta con este correo.')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);

  // Navigation between the two forms.
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/register$/);

  assertClean();
});

test('login validates empty fields and anonymous root goes to /login', async ({ page }) => {
  const assertClean = watch(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Ingresa un correo válido.')).toBeVisible();
  await expect(page.getByText('Ingresa tu contraseña.')).toBeVisible();

  assertClean();
});
