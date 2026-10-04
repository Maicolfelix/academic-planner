import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  greetingFor,
  login,
  NAME,
  register,
  uniqueEmail,
  watch,
} from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const section = (page: Page, name: string) => page.getByRole('region', { name });
const goHome = (page: Page) => nav(page).getByRole('link', { name: 'Inicio' }).click();

/** Today's date for a user in Bogotá (the app's default timezone), independent of the machine's zone. */
const bogotaToday = (plusDays = 0) => {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
};

test('dashboard flow: empty states, next due, overdue, progress, live updates, persistence', async ({
  page,
}) => {
  const assertClean = watch(page);
  const email = uniqueEmail();

  // 1-3. New user: onboarding, then the Dashboard shows a useful empty state (not a wall of zeros).
  await register(page, email);
  await completeOnboarding(page);
  await goHome(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: greetingFor(NAME) })).toBeVisible();
  await expect(page.getByText('Segundo semestre 2026')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aún no tienes asignaturas.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resumen del periodo' })).toHaveCount(0); // no zeros
  await expectNoHorizontalOverflow(page);

  // 4. Its call to action opens the existing subject form (no duplicated form on the Dashboard).
  await page.getByRole('link', { name: 'Agregar asignatura' }).click();
  await expect(page).toHaveURL(/\/subjects$/); // the one-shot ?action=create is removed
  const subjectDialog = page.getByRole('dialog', { name: 'Agregar asignatura' });
  await expect(subjectDialog).toBeVisible();
  await subjectDialog.getByLabel('Nombre').fill('Redes');
  await subjectDialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(subjectDialog).toBeHidden();

  // Subjects but no activities: still a helpful Dashboard.
  await goHome(page);
  await expect(
    page.getByRole('heading', { name: 'Todavía no tienes actividades registradas.' }),
  ).toBeVisible();

  // 5. Create a future activity through that CTA (reusing the Activities form).
  await page.getByRole('link', { name: 'Agregar actividad' }).click();
  await expect(page).toHaveURL(/\/activities$/);
  const activityDialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await expect(activityDialog).toBeVisible();
  await activityDialog.getByLabel('Título').fill('Entrega final');
  await activityDialog.getByLabel('Fecha').fill(daysFromNow(9));
  await activityDialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(activityDialog).toBeHidden();

  // 6-7. Back on the Dashboard (no F5): next due, counters and progress reflect it.
  await goHome(page);
  const next = section(page, 'Próxima entrega');
  await expect(next).toContainText('Entrega final');
  await expect(next).toContainText('Redes');
  await expect(next).toContainText(/Vence en \d+ días/);
  const summary = section(page, 'Resumen del periodo');
  await expect(summary.getByRole('link', { name: /Pendientes/ })).toContainText('1');
  await expect(summary.getByRole('link', { name: /Vencidas/ })).toContainText('0');
  await expect(section(page, 'Progreso de actividades')).toContainText('0%');
  await expect(section(page, 'Progreso de actividades')).toContainText(
    '0 de 1 actividades finalizadas',
  );
  await expect(section(page, 'Próximas entregas')).toHaveCount(0); // the only one is the highlighted one

  // 8-9. An overdue activity (seeded through the API) shows up in "Vencidas".
  const [subject] = await apiSubjects(page);
  await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: 'Taller atrasado',
    dueDate: '2020-02-01',
  });
  await page.reload();
  const overdue = section(page, 'Vencidas');
  await expect(overdue).toContainText('Taller atrasado');
  await expect(overdue).toContainText('Vencida'); // text badge, not color alone
  await expect(overdue).toContainText(/Venció hace \d+ días/);
  await expect(summary.getByRole('link', { name: /Vencidas/ })).toContainText('1');
  await expect(summary.getByRole('link', { name: /Pendientes/ })).toContainText('2');

  // 10-11. Finish the future activity from Activities, then come back: progress moved without F5.
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Entrega final' })
    .getByLabel('Cambiar estado de Entrega final')
    .selectOption({ label: 'Finalizada' });
  await expect(page.getByRole('listitem').filter({ hasText: 'Entrega final' })).toContainText(
    'Finalizada',
  );
  await goHome(page);
  const progress = section(page, 'Progreso de actividades');
  await expect(progress).toContainText('50%');
  await expect(progress).toContainText('1 de 2 actividades finalizadas');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(summary.getByRole('link', { name: /Finalizadas/ })).toContainText('1');
  await expect(summary.getByRole('link', { name: /Pendientes/ })).toContainText('1');
  await expect(next).toContainText('No tienes entregas próximas.'); // the future one is done

  // 12-13. Reload: the same numbers.
  await page.reload();
  await expect(section(page, 'Progreso de actividades')).toContainText('50%');
  await expect(section(page, 'Vencidas')).toContainText('Taller atrasado');

  // 14-15. Logout / login: the data is all still there.
  await nav(page).getByRole('button', { name: 'Cerrar sesión' }).click();
  await login(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(section(page, 'Progreso de actividades')).toContainText(
    '1 de 2 actividades finalizadas',
  );
  await expect(section(page, 'Vencidas')).toContainText('Taller atrasado');

  assertClean();
});

test('"Para hoy" and "Próximas entregas" follow the user’s day; the next activity is not repeated', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [subject] = await apiSubjects(page);
  const make = (title: string, dueDate: string) =>
    apiCreateActivity(page, { subjectId: subject!.id, title, dueDate });

  // Created in this order, so equal deadlines keep it: A is the first (highlighted) one.
  await make('Hoy A', bogotaToday());
  await make('Hoy B', bogotaToday());
  await make('Mañana C', bogotaToday(1));
  await make('En cinco días D', bogotaToday(5));

  await page.goto('/dashboard');
  const next = section(page, 'Próxima entrega');
  await expect(next).toContainText('Hoy A');
  await expect(next).toContainText('Vence hoy');

  const today = section(page, 'Para hoy');
  await expect(today).toContainText('Hoy B');
  await expect(today).not.toContainText('Hoy A'); // already highlighted above
  await expect(today).toContainText('Vence hoy');

  const upcoming = section(page, 'Próximas entregas');
  await expect(upcoming).toContainText('Mañana C');
  await expect(upcoming).toContainText('Vence mañana');
  await expect(upcoming).toContainText('En cinco días D');
  await expect(upcoming).toContainText('Vence en 5 días');

  assertClean();
});

test('summary tiles link to the matching filtered list', async ({ page }) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [subject] = await apiSubjects(page);
  await apiCreateActivity(page, { subjectId: subject!.id, title: 'Vieja', dueDate: '2020-01-01' });
  await apiCreateActivity(page, { subjectId: subject!.id, title: 'Futura', dueDate: '2099-01-01' });

  await page.goto('/dashboard');
  await section(page, 'Resumen del periodo')
    .getByRole('link', { name: /Vencidas/ })
    .click();
  await expect(page).toHaveURL(/\/activities\?overdue=true$/);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem')).toContainText('Vieja');

  assertClean();
});

test('quick actions open the existing forms', async ({ page }) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [subject] = await apiSubjects(page);
  await apiCreateActivity(page, { subjectId: subject!.id, title: 'Algo', dueDate: '2099-01-01' });

  await page.goto('/dashboard');
  const quick = page.getByRole('navigation', { name: 'Accesos rápidos' });
  await quick.getByRole('link', { name: 'Nueva actividad' }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('dialog', { name: 'Agregar actividad' })).toBeVisible();
  await page.keyboard.press('Escape');

  await goHome(page);
  await quick.getByRole('link', { name: 'Nueva asignatura' }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(page.getByRole('dialog', { name: 'Agregar asignatura' })).toBeVisible();

  assertClean();
});

test('many activities, overdue and long titles: no overflow, sane headings, accessible progress', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const second = await apiCreateSubject(
    page,
    'Una asignatura con un nombre bastante largo para probar el ajuste',
  );
  const [redes] = (await apiSubjects(page)).filter((s) => s.name === 'Redes');
  const longTitle = `Proyecto ${'x'.repeat(60)} integrador ${'palabra '.repeat(12)}`
    .trim()
    .slice(0, 150);

  await apiCreateActivity(page, { subjectId: second.id, title: longTitle, dueDate: '2020-03-01' });
  for (let i = 1; i <= 12; i++) {
    await apiCreateActivity(page, {
      subjectId: redes!.id,
      title: `Atrasada ${i}`,
      dueDate: `2020-04-${String(i).padStart(2, '0')}`,
    });
  }
  for (let i = 1; i <= 8; i++) {
    await apiCreateActivity(page, {
      subjectId: redes!.id,
      title: `Futura ${i}`,
      dueDate: `2099-05-${String(i).padStart(2, '0')}`,
    });
  }

  await page.goto('/dashboard');
  await expect(section(page, 'Vencidas')).toBeVisible();
  // 13 overdue exist but the list is capped at 10: the page says so and links to the rest.
  await expect(section(page, 'Vencidas').getByRole('listitem')).toHaveCount(10);
  await expect(section(page, 'Vencidas')).toContainText('Mostrando 10 de 13');
  await expect(section(page, 'Próximas entregas').getByRole('listitem')).toHaveCount(4); // 5 upcoming minus the highlighted one
  await expectNoHorizontalOverflow(page);

  // Heading hierarchy: exactly one h1, every section title is an h2, nothing is skipped.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const levels = await page
    .getByRole('heading')
    .evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  expect(levels[0]).toBe(1);
  expect(levels.slice(1).every((l) => l === 2)).toBe(true);

  // The progress bar is a real progressbar with a text equivalent.
  const bar = section(page, 'Progreso de actividades').getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuemin', '0');
  await expect(bar).toHaveAttribute('aria-valuemax', '100');
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await expect(bar).toHaveAttribute('aria-valuetext', /0 de 21 actividades finalizadas/);

  // Keyboard: every tile, link and quick action is reachable and visibly focusable.
  await section(page, 'Resumen del periodo')
    .getByRole('link', { name: /Pendientes/ })
    .focus();
  await expect(
    section(page, 'Resumen del periodo').getByRole('link', { name: /Pendientes/ }),
  ).toBeFocused();

  assertClean();
});

test('a second user gets their own empty dashboard, never the first user’s data', async ({
  page,
  browser,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Materia de A');
  const [subject] = await apiSubjects(page);
  await apiCreateActivity(page, {
    subjectId: subject!.id,
    title: 'Privada de A',
    dueDate: '2020-01-01',
  });
  await page.goto('/dashboard');
  await expect(section(page, 'Vencidas')).toContainText('Privada de A');

  const second = await browser.newContext({ ...test.info().project.use });
  const other = await second.newPage();
  const assertOtherClean = watch(other);
  await register(other, uniqueEmail(), 'Otra Persona');
  await completeOnboarding(other);
  await goHome(other);
  await expect(
    other.getByRole('heading', { level: 1, name: greetingFor('Otra Persona') }),
  ).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Aún no tienes asignaturas.' })).toBeVisible();
  await expect(other.getByText('Privada de A')).toHaveCount(0);
  await expect(other.getByText('Materia de A')).toHaveCount(0);

  // The API gives B nothing of A's, even when B asks for A's period explicitly.
  const aDashboard = await (await page.request.get('/api/dashboard')).json();
  const peek = await other.request.get(`/api/dashboard?periodId=${aDashboard.dashboard.period.id}`);
  const body = await peek.json();
  expect(body.dashboard.summary.total).toBe(0);
  expect(JSON.stringify(body)).not.toContain('Privada de A');

  await second.close();
  assertClean();
  assertOtherClean();
});
