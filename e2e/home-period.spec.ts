import { expect, test, type Page } from '@playwright/test';
import { register, uniqueEmail, watch } from './helpers';

/**
 * The app opens only with a HOME current period, which the server decides: the general current period; else the primary
 * active study's; else none. A current period of a SECONDARY study never opens it. These studies are set up by the API (there
 * is no studies screen yet) and the browser must follow what the server says.
 */
const DATES = { startDate: '2026-08-03', endDate: '2026-11-28' };

const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};
const home = async (page: Page) =>
  (await (await page.request.get('/api/periods/home')).json()).period as { id: string } | null;
const study = async (page: Page, name: string, type = 'UNIVERSITY') =>
  (await post(page, '/api/study-tracks', { name, type })).studyTrack as { id: string };
const period = async (page: Page, name: string, studyTrackId?: string) =>
  (await post(page, '/api/periods', { name, ...DATES, ...(studyTrackId && { studyTrackId }) }))
    .period as { id: string; isCurrent: boolean };

const start = async (page: Page) => {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/); // the session cookie is set: the API can be used
};

test('a current period of a SECONDARY study does not open the app: the onboarding still asks for the home one', async ({
  page,
}) => {
  const assertClean = watch(page);
  await start(page);
  await study(page, 'Medicina'); // the primary study, with no current period
  const diploma = await study(page, 'Diplomado', 'OTHER_ACADEMIC');
  const secondary = await period(page, 'Cohorte oct–dic', diploma.id);
  expect(secondary.isCurrent).toBe(true);

  // the server says there is no home period, even though the list has a current one
  expect(await home(page)).toBeNull();
  const listed = (await (await page.request.get('/api/periods')).json()).periods as {
    isCurrent: boolean;
  }[];
  expect(listed.some((p) => p.isCurrent)).toBe(true);

  for (const path of ['/dashboard', '/subjects', '/activities', '/calendar']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/onboarding$/);
  }
  assertClean();
});

test('the primary study’s current period opens the app, and a general current period takes over as home', async ({
  page,
}) => {
  const assertClean = watch(page);
  await start(page);
  const medicina = await study(page, 'Medicina');
  const primary = await period(page, '2026-2', medicina.id);
  expect((await home(page))?.id).toBe(primary.id);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);

  const general = await period(page, 'Mi planificación');
  expect(general.isCurrent).toBe(true); // the first of the general scope, and the primary study's one stays current
  expect((await home(page))?.id).toBe(general.id);
  await page.goto('/subjects');
  await expect(page).toHaveURL(/\/subjects$/);
  assertClean();
});

test('the browser follows HOME when the primary study changes or is archived', async ({ page }) => {
  const assertClean = watch(page);
  await start(page);
  const a = await study(page, 'A');
  const b = await study(page, 'B', 'SCHOOL');
  const pa = await period(page, 'PA', a.id);
  const pb = await period(page, 'PB', b.id);
  expect((await home(page))?.id).toBe(pa.id);

  await post(page, `/api/study-tracks/${b.id}/make-primary`);
  expect((await home(page))?.id).toBe(pb.id);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);

  await post(page, `/api/study-tracks/${a.id}/archive`);
  await post(page, `/api/study-tracks/${b.id}/archive`); // the only active one: its current period is turned off
  expect(await home(page)).toBeNull();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding$/);
  assertClean();
});
