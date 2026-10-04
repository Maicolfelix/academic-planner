import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Local Bogotá date and time `offsetMs` from now, the way a student would type them. Offsets used here sit in
 * the MIDDLE of each Radar band (12 h, 2 d, 5 d, 10 d), so the minute rounding of the form can never move an
 * activity across a limit and the test does not depend on the exact second it runs.
 */
function inBogota(offsetMs: number) {
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

async function newUserWithSubject(page: Page, subjectName = 'Redes') {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, subjectName);
}

/** The five categories plus a finished one, through the API (the UI creation flow is covered elsewhere). */
async function seedRadar(page: Page) {
  const [subject] = await apiSubjects(page);
  const make = (title: string, offsetMs: number) =>
    apiCreateActivity(page, { subjectId: subject!.id, title, type: 'TASK', ...inBogota(offsetMs) });
  const overdue = await make('Entrega vencida', -2 * DAY);
  const immediate = await make('Entrega inmediata', 12 * HOUR);
  const upcoming = await make('Entrega próxima', 2 * DAY);
  const plannable = await make('Entrega planificable', 5 * DAY);
  const control = await make('Entrega bajo control', 10 * DAY);
  const done = await make('Entrega finalizada', 12 * HOUR);
  const res = await page.request.patch(`/api/activities/${done.id}`, {
    data: { status: 'COMPLETED' },
  });
  expect(res.status()).toBe(200);
  return { overdue, immediate, upcoming, plannable, control, done };
}

const radarRegion = (page: Page) => page.getByRole('region', { name: 'Radar académico' });
const row = (page: Page, label: string, count: number) =>
  radarRegion(page).getByRole('link', { name: new RegExp(`${label}\\s*${count}$`) });
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

test('radar flow: counts, filtered list, finishing an activity, reload, responsive', async ({
  page,
}) => {
  const assertClean = watch(page);

  // 1-3. New user, current period, subject "Redes".
  await newUserWithSubject(page);

  // 4-9. Overdue, in 12 h, in 2 days, in 5 days, in 10 days, and a finished one.
  await seedRadar(page);

  // 10-11. Dashboard: the Radar summary counts the five categories and ignores the finished activity.
  await page.goto('/dashboard');
  await expect(radarRegion(page).getByRole('heading', { name: 'Radar académico' })).toBeVisible();
  await expect(row(page, 'Vencidas', 1)).toBeVisible();
  await expect(row(page, 'Atención inmediata', 1)).toBeVisible();
  await expect(row(page, 'Próximas', 1)).toBeVisible();
  await expect(row(page, 'Planificables', 1)).toBeVisible();
  await expect(row(page, 'Bajo control', 1)).toBeVisible();
  await expect(radarRegion(page).getByRole('listitem')).toHaveCount(5);
  await expectNoHorizontalOverflow(page);

  // 12-13. "Atención inmediata" opens Activities filtered: only the right activity is listed.
  await row(page, 'Atención inmediata', 1).click();
  await expect(page).toHaveURL(/\/activities\?radar=IMMEDIATE$/);
  await expect(page.getByLabel('Radar', { exact: true })).toHaveValue('IMMEDIATE');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  const inmediata = card(page, 'Entrega inmediata');
  await expect(inmediata).toBeVisible();
  await expect(inmediata.getByText('Atención inmediata')).toBeVisible(); // Radar badge, text + symbol
  await expect(inmediata).toContainText(/Vence en 1[12] horas/); // real time left, not "mañana"
  await expectNoHorizontalOverflow(page);

  // 14. Back to the Dashboard.
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 15-16. Finishing the immediate one removes it from the Radar (list and counts).
  await page.goto('/activities?radar=IMMEDIATE');
  await page.getByLabel('Cambiar estado de Entrega inmediata').selectOption('Finalizada');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(row(page, 'Atención inmediata', 0)).toBeVisible();
  await expect(row(page, 'Vencidas', 1)).toBeVisible();

  // 17-18. After a reload everything persists and is recomputed from the stored data.
  await page.reload();
  await expect(row(page, 'Atención inmediata', 0)).toBeVisible();
  await expect(row(page, 'Próximas', 1)).toBeVisible();
  await expect(row(page, 'Planificables', 1)).toBeVisible();
  await expect(row(page, 'Bajo control', 1)).toBeVisible();

  // Finished activities show no Radar badge at all.
  await page.goto('/activities?status=COMPLETED');
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('listitem').getByText('Atención inmediata')).toHaveCount(0);
  await expect(page.getByRole('listitem').getByText('Bajo control')).toHaveCount(0);
  await expect(page.getByRole('listitem').getByText('Vencida')).toHaveCount(0);

  // 19. Responsive: no sideways scroll and comfortable targets, with the summary on a phone or a desktop.
  await page.goto('/dashboard');
  await expectNoHorizontalOverflow(page);
  const box = (await row(page, 'Vencidas', 1).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  // 20. No console errors, no uncaught exceptions and no failed API calls along the whole flow.
  assertClean();
});

test('activity cards: one Radar badge per open activity, none when finished, wording by category', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await seedRadar(page);
  await page.goto('/activities');

  const badge = (title: string, text: string) => card(page, title).getByText(text, { exact: true });
  await expect(badge('Entrega vencida', 'Vencida')).toBeVisible();
  await expect(card(page, 'Entrega vencida')).toContainText('Venció hace 2 días');
  await expect(badge('Entrega inmediata', 'Atención inmediata')).toBeVisible();
  await expect(badge('Entrega próxima', 'Próxima')).toBeVisible();
  await expect(card(page, 'Entrega próxima')).toContainText(/Vence en 2 días/);
  await expect(badge('Entrega planificable', 'Planificable')).toBeVisible();
  await expect(card(page, 'Entrega planificable')).toContainText(/Vence en 5 días/);
  await expect(badge('Entrega bajo control', 'Bajo control')).toBeVisible();
  await expect(card(page, 'Entrega bajo control')).toContainText(/Vence en 10 días/);

  // The finished one: no Radar badge, no Radar wording.
  const finished = card(page, 'Entrega finalizada');
  await expect(finished).toBeVisible();
  await expect(finished.getByText('Atención inmediata')).toHaveCount(0);
  await expect(finished).not.toContainText('Vence en');
  assertClean();
});

test('/radar page: groups, "+ N más" link and a way back, without a navbar entry', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  const [subject] = await apiSubjects(page);
  // 12 activities in 12 h: more than the 10 listed per group.
  for (let i = 1; i <= 12; i++) {
    await apiCreateActivity(page, {
      subjectId: subject!.id,
      title: `Inmediata ${String(i).padStart(2, '0')}`,
      ...inBogota(12 * HOUR + i * 60_000),
    });
  }
  await apiCreateActivity(page, { subjectId: subject!.id, title: 'Lejana', ...inBogota(10 * DAY) });

  // The main navigation does not get a Radar entry: Dashboard -> Radar -> detail.
  await page.goto('/dashboard');
  await expect(
    page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Radar' }),
  ).toHaveCount(0);
  await radarRegion(page).getByRole('link', { name: 'Ver el Radar completo' }).click();
  await expect(page).toHaveURL(/\/radar$/);

  await expect(page.getByRole('heading', { level: 1, name: 'Radar académico' })).toBeVisible();
  await expect(page.getByText('No es prioridad ni una recomendación')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Atención inmediata (12)' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Bajo control (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Vencidas/ })).toHaveCount(0); // empty groups are not drawn
  const immediate = page.getByRole('region', { name: 'Atención inmediata (12)' });
  await expect(immediate.getByRole('listitem')).toHaveCount(10);
  await expect(immediate.getByRole('listitem').first()).toContainText('Inmediata 01'); // soonest first
  await expect(immediate).toContainText(/Vence en 1[23] horas/);
  await expect(page.getByText('+ 2 más.')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // "+ N más" leads to the filtered Activities list, which shows all twelve.
  await page.getByRole('link', { name: 'Ver todas en Actividades' }).click();
  await expect(page).toHaveURL(/\/activities\?radar=IMMEDIATE$/);
  await expect(page.getByRole('listitem')).toHaveCount(12);

  assertClean();
});

test('time alone changes the category on screen, with no reload and no write', async ({ page }) => {
  const assertClean = watch(page);
  await newUserWithSubject(page);
  const [subject] = await apiSubjects(page);
  // 26 h from now: "Próxima". The browser clock is faked; the data is never touched.
  await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: 'Cruza el límite',
    ...inBogota(26 * HOUR),
  });

  await page.clock.install({ time: new Date() });
  await page.goto('/activities');
  const target = card(page, 'Cruza el límite');
  await expect(target.getByText('Próxima', { exact: true })).toBeVisible();

  await page.clock.fastForward('03:00:00'); // 3 hours later: 23 h left
  await expect(target.getByText('Atención inmediata', { exact: true })).toBeVisible();
  await expect(target.getByText('Próxima', { exact: true })).toHaveCount(0);
  await expect(target).toContainText(/Vence en 2[23] horas/);

  await page.clock.fastForward('24:00:00'); // a day later: past the deadline
  await expect(target.getByText('Vencida', { exact: true })).toBeVisible();
  assertClean();
});

test('the category depends on the instant, not on the browser’s timezone', async ({ browser }) => {
  // The browser believes it is in Tokyo (UTC+9); the profile is Bogotá (UTC-5).
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const assertClean = watch(page);
  await newUserWithSubject(page);
  await seedRadar(page);

  await page.goto('/dashboard');
  await expect(row(page, 'Vencidas', 1)).toBeVisible();
  await expect(row(page, 'Atención inmediata', 1)).toBeVisible();
  await expect(row(page, 'Próximas', 1)).toBeVisible();
  await expect(row(page, 'Planificables', 1)).toBeVisible();
  await expect(row(page, 'Bajo control', 1)).toBeVisible();

  await page.goto('/activities?radar=IMMEDIATE');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(card(page, 'Entrega inmediata')).toContainText(/Vence en 1[12] horas/); // same wording: real duration
  assertClean();
  await context.close();
});

test('layout and accessibility: keyboard, headings, long names and no color-only meaning', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUserWithSubject(page, 'Asignatura con un nombre bastante largo de verdad');
  const [subject] = await apiSubjects(page);
  const long = `Entrega ${'muy larga '.repeat(8)}Supercalifragilisticoespialidosoynadamás`;
  await apiCreateActivity(page, { subjectId: subject!.id, title: long, ...inBogota(12 * HOUR) });

  await page.goto('/dashboard');
  // Every category row has visible text and a count; the symbol is decorative.
  for (const label of [
    'Vencidas',
    'Atención inmediata',
    'Próximas',
    'Planificables',
    'Bajo control',
  ]) {
    await expect(radarRegion(page).getByText(label, { exact: true })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);

  // Keyboard: Tab reaches a category and Enter opens the filtered list.
  await radarRegion(page)
    .getByRole('link', { name: /Atención inmediata/ })
    .focus();
  await expect(radarRegion(page).getByRole('link', { name: /Atención inmediata/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/radar=IMMEDIATE/);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  await page.goto('/radar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // The filter is reachable and labelled; clearing it works with the keyboard too.
  await page.goto('/activities?radar=IMMEDIATE');
  await expect(page.getByLabel('Radar', { exact: true })).toHaveValue('IMMEDIATE');
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page).not.toHaveURL(/radar=/);
  assertClean();
});
