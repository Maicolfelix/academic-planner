import { expect, test, type Page } from '@playwright/test';
import {
  completeOnboarding,
  greetingFor,
  login,
  NAME,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Signs out once the Home has really finished loading (its heading is there and no request is left in flight).
 *
 * Why: the Home starts new queries as its data arrives (the profile one when its notice mounts). Clicking "Cerrar sesión" while the
 * Home is still loading lets those queries start AFTER the logout began, against a session the server has already closed: a 401 on
 * a request nobody could have avoided from the test side (TEST-REL-3, a ~20 ms window, about 1 run in 30). A URL assertion is not
 * enough: right after a redirect it is already true while the screen has not loaded.
 */
async function signOutWhenLoaded(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
}

test('full auth flow: register, persist, logout, guard, login, wrong credentials', async ({
  page,
  context,
}) => {
  // A background refresh (reminders, radar, attention poll every minute and on focus) can be in flight at the very
  // moment of signing out; the server correctly answers it 401. That is not an error of the app.
  const assertClean = watch(page, ['401 /api/reminders/*', '401 /api/radar', '401 /api/attention']);
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
  await signOutWhenLoaded(page);
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
  await signOutWhenLoaded(page);
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

// TEST-REL-3, made deterministic. The browser hears about the Home's data late (the server answered at once) and about the logout
// even later (the server closed the session at once). Signing out while the Home loads fails every time (a 401 on the profile
// request the Home starts after the logout began); signing out once it has loaded never does. `page.route` needs the service worker
// out of the way, as in the other specs that fake the network.
test.describe('signing out while the Home is slow to arrive', () => {
  test.use({ serviceWorkers: 'block' });

  test('no request of the screen starts after the logout began', async ({ page }) => {
    const assertClean = watch(page);
    await register(page, uniqueEmail());
    await completeOnboarding(page);

    const holdAnswer = async (pattern: string, ms: number) =>
      page.route(pattern, async (route) => {
        const answer = await route.fetch(); // the server has already answered...
        await new Promise((resolve) => setTimeout(resolve, ms)); // ...and the browser hears late
        await route.fulfill({ response: answer });
      });
    await holdAnswer('**/api/dashboard', 600);
    await holdAnswer('**/api/auth/logout', 1800);

    await page.goto('/dashboard');
    await signOutWhenLoaded(page);
    await expect(page).toHaveURL(/\/login$/);
    assertClean();
  });
});
