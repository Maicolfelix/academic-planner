import { expect, type Page } from '@playwright/test';

export const uniqueEmail = () =>
  `ana+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
export const PASSWORD = 'correct horse battery';

/** The Dashboard heading: a time-of-day greeting (decided by the backend) plus the user's name. */
export const greetingFor = (name: string) =>
  new RegExp(`^(Buenos días|Buenas tardes|Buenas noches), ${name}$`);
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
    if (m.type() === 'error' && !/status of 40[019]/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith('/api/') || r.status() < 400) return;
    const expected = r.status() === 401 && /^\/api\/auth\/(me|login)$/.test(url.pathname);
    const label = `${r.status()} ${url.pathname}`;
    // An entry ending in "*" matches by prefix (e.g. "409 /api/subjects/*" for any subject id).
    const listed = alsoExpected.some((e) =>
      e.endsWith('*') ? label.startsWith(e.slice(0, -1)) : e === label,
    );
    if (!expected && !listed) failedApi.push(label);
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
export async function completeOnboarding(
  page: Page,
  periodName = 'Segundo semestre 2026',
  dates: { start: string; end: string } = { start: '2026-08-03', end: '2026-11-28' },
) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Nombre del periodo').fill(periodName);
  await page.getByLabel('Inicio', { exact: true }).fill(dates.start);
  await page.getByLabel('Fin', { exact: true }).fill(dates.end);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/subjects$/);
}

/** Today's date for a user in Bogotá (the app's default timezone), whatever the machine's zone is. */
export const bogotaToday = (plusDays = 0): string =>
  new Date(Date.now() + plusDays * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  });

/** A page must never scroll sideways, in any state (including with a dialog open). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

/** Creates a subject through the UI (from /subjects). */
export async function addSubjectViaUi(page: Page, name: string) {
  await page.getByRole('button', { name: 'Agregar asignatura' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** YYYY-MM-DD, `days` from today (machine date: only used to pick a "near future" deadline). */
export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Seeds data through the API with the page's session (faster than clicking through the UI). */
export async function apiSubjects(page: Page) {
  const res = await page.request.get('/api/subjects');
  return (await res.json()).subjects as { id: string; name: string; periodId: string }[];
}

export async function apiCreateSubject(page: Page, name: string) {
  const [first] = await apiSubjects(page);
  const res = await page.request.post('/api/subjects', {
    data: { periodId: first!.periodId, name },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).subject as { id: string; name: string };
}

export async function apiCreateActivity(page: Page, data: Record<string, unknown>) {
  const res = await page.request.post('/api/activities', { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).activity as { id: string; title: string };
}

/**
 * Local Bogotá date and time `offsetMs` from now, the way a student would type them. Offsets used here sit in
 * the MIDDLE of each Radar band (12 h, 2 d, 5 d, 10 d), so the minute rounding of the form can never move an
 * activity across a limit and the test does not depend on the exact second it runs.
 */
export function inBogota(offsetMs: number) {
  const d = new Date(Date.now() + offsetMs);
  return {
    dueDate: d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    dueTime: d.toLocaleTimeString('en-GB', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }),
  };
}
