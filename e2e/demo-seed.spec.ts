import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createPrisma } from '../apps/api/src/db/prisma';
import { DEMO_PASSWORD } from '../apps/api/src/demo/demoPlan';
import { deleteDemoUser, seedDemo } from '../apps/api/src/demo/seedDemo';
import { getTestDatabaseUrl } from '../apps/api/test/testDb';
import { expectNoHorizontalOverflow, login, watch, entrancesDone } from './helpers';

/**
 * Phase 18: the demo, as the person presenting it would use it. The seed is run against the TEST database with the
 * browser's own "now", then everything is checked through the real screens. It is a separate spec on purpose: no
 * other test depends on the seed. Each browser project gets its own demo user, because both run in parallel.
 */

const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name });
const CLASSES = [
  'Redes de Computadores',
  'Bases de Datos',
  'Bioestadística',
  'Epidemiología',
  'Programación Web',
  'Seguridad Informática',
];
const flat = (s: string) => s.replace(/\s+/g, ' ');

test('the demo seed gives a populated, coherent product: sign in, Dashboard, Radar, Agenda, Progress, reset', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `demo.${testInfo.project.name}@academicplanner.local`;
  const prisma = createPrisma(getTestDatabaseUrl());
  const assertClean = watch(page);

  try {
    await seedDemo(prisma, { now: new Date(), email });

    // The demo signs in like any student: no shortcut.
    await page.goto('/login');
    await login(page, email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    // Dashboard: one clear recommendation, Radar with several bands, progress, the week.
    await expect(region(page, '¿Qué hago ahora?')).toContainText('Parcial 1 de Redes');
    await expect(region(page, '¿Qué hago ahora?')).toContainText('Redes de Computadores');
    const radar = flat(await region(page, 'Radar académico').innerText());
    for (const [label, count] of [
      ['Vencidas', 1],
      ['Atención inmediata', 2],
      ['Próximas', 2],
      ['Planificables', 3],
      ['Bajo control', 3],
    ] as const) {
      expect(radar, label).toMatch(new RegExp(String.raw`${label}\s*\S?\s*${count}`));
    }
    await expect(region(page, 'Progreso de actividades')).toContainText(
      '4 de 15 actividades finalizadas',
    );
    await expect(region(page, 'Progreso de actividades')).toContainText('27%');
    const thisWeek = flat(await region(page, 'Esta semana').innerText());
    expect(thisWeek).toMatch(/\d+ compromisos/);
    expect(thisWeek).toContain('Día con más compromisos');
    await expectNoHorizontalOverflow(page);
    // axe reads the colors the page has at that instant: let the entrances (the Radar tiles rise in one after another) end,
    // or a tile caught at 60 % reads 1.4:1 (it did, on main too)
    await entrancesDone(page);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // Activities: the 15 of the plan, readable titles.
    await page.goto('/activities');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Parcial 1 de Redes' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Quiz de normalización' }),
    ).toBeVisible();
    expect(await page.getByLabel(/^Cambiar estado de /).count()).toBe(15);
    await expectNoHorizontalOverflow(page);

    // Agenda: this week has the six classes (the API says so on every device; the grid shows them all from 1024 px,
    // a phone shows one day at a time).
    const week = (await (await page.request.get('/api/schedule')).json()).occurrences as {
      title: string;
    }[];
    expect(week.map((o) => o.title).sort()).toEqual([...CLASSES].sort());
    await page.goto('/calendar');
    if (testInfo.project.name.startsWith('desktop')) {
      for (const subject of CLASSES) await expect(page.getByText(subject).first()).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);

    // Progress and Radar screens.
    await page.goto('/progress');
    await expect(page.locator('main')).toContainText('27%');
    await expectNoHorizontalOverflow(page);
    await page.goto('/radar');
    await expect(page.locator('main')).toContainText('Parcial 1 de Redes');
    await expectNoHorizontalOverflow(page);

    assertClean(); // everything above ran with no console error, uncaught exception or failed API call

    // Reset: run the same command again. The old browser session ends, and signing in gives the initial dataset.
    await seedDemo(prisma, { now: new Date(), email });
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await page.goto('/login');
    await login(page, email, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(region(page, '¿Qué hago ahora?')).toContainText('Parcial 1 de Redes');
    expect(await prisma.activity.count({ where: { user: { email } } })).toBe(15);

    await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await deleteDemoUser(prisma, email);
    await prisma.$disconnect();
  }
});
