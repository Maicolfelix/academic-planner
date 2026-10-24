import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  inBogota,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * P9-2: first use that offers real ways in (not only "add by hand") and a Home where every block answers its own question.
 * Only routes and capabilities that already existed are linked.
 */
test.setTimeout(120_000);

const H = 3_600_000;
const D = 24 * H;
const region = (page: Page, name: string) => page.getByRole('region', { name });
const companion = (page: Page) => page.locator('[data-companion]');
const bogotaClock = () =>
  new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
const minutesNow = () => {
  const [h, m] = bogotaClock().split(':').map(Number);
  return h! * 60 + m!;
};

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
}

/** How many times this text is on screen as a piece of text: not inert (a slide off screen), not screen-reader only. */
const visibleCount = (page: Page, text: string) =>
  page.evaluate((t) => {
    const root = document.querySelector('main') ?? document.body;
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement!;
      if (el.closest('[inert], .sr-only, [aria-hidden="true"]')) continue;
      n += node.textContent!.split(t).length - 1;
    }
    return n;
  }, text);

test('an account with nothing yet is offered its timetable and capture before adding by hand', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Empieza con lo que ya tienes.' })).toBeVisible();
  const ways = page.locator('section', {
    has: page.getByRole('heading', { name: 'Empieza con lo que ya tienes.' }),
  });
  await expect(ways.getByRole('link')).toHaveText([
    'Importar mi horario',
    'Captura rápida',
    'Añadir asignatura manualmente',
  ]);
  await expectNoHorizontalOverflow(page);

  // every way leads somewhere real
  await ways.getByRole('link', { name: 'Importar mi horario' }).click();
  await expect(page).toHaveURL(/\/calendar\/import$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.goto('/dashboard');
  await ways.getByRole('link', { name: 'Captura rápida' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('textbox')).toBeVisible();

  await page.goto('/dashboard');
  await ways.getByRole('link', { name: 'Añadir asignatura manualmente' }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(page.getByRole('dialog', { name: 'Agregar asignatura' })).toBeVisible();
  assertClean();
});

test('the first way in is reachable and visibly focused from the keyboard', async ({ page }) => {
  await newUser(page);
  await page.goto('/dashboard');
  const first = page.getByRole('link', { name: 'Importar mi horario' });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Captura rápida' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Añadir asignatura manualmente' })).toBeFocused();
});

test('with a subject but nothing registered: capture here, a calendar file, or by hand', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto('/subjects');
  await addSubjectViaUi(page, 'Redes');
  await page.goto('/dashboard');

  const title = page.getByRole('heading', { name: 'Registra lo que tienes pendiente.' });
  await expect(title).toBeVisible();
  const ways = page.locator('section', { has: title });
  // the timetable import is not offered again here
  await expect(ways.getByRole('link', { name: 'Importar mi horario' })).toHaveCount(0);
  await expect(ways.getByRole('link')).toHaveText([
    'Importar calendario .ics',
    'Añadir actividad manualmente',
  ]);

  // capture is on this very page: the button takes the student to its box (no navigation)
  await ways.getByRole('button', { name: 'Captura rápida' }).click();
  await expect(page.getByLabel('Escribe lo que tienes pendiente')).toBeFocused();
  await expect(page).toHaveURL(/\/dashboard$/);

  await ways.getByRole('link', { name: 'Importar calendario .ics' }).click();
  await expect(page).toHaveURL(/\/calendar\/import-ics$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.goto('/dashboard');
  await ways.getByRole('link', { name: 'Añadir actividad manualmente' }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('dialog', { name: 'Agregar actividad' })).toBeVisible();
  assertClean();
});

test.describe('a Home with representative data', () => {
  async function seed(page: Page) {
    await newUser(page);
    await page.goto('/subjects');
    await addSubjectViaUi(page, 'Redes de Computadores');
    const [redes] = await apiSubjects(page);
    const cripto = await apiCreateSubject(page, 'Ciberseguridad');
    const rows: [string, string, number, string?][] = [
      [redes!.id, 'Informe atrasado', -2 * D],
      [redes!.id, 'Quiz de redes', 5 * H, 'IN_PROGRESS'],
      [cripto.id, 'Taller de criptografía', 2 * D],
      [redes!.id, 'Parcial 1 de redes', 6 * D],
      [cripto.id, 'Informe de laboratorio', 9 * D],
      [cripto.id, 'Entrega final', 21 * D],
    ];
    for (const [subjectId, title, offset, status] of rows) {
      const a = await apiCreateActivity(page, {
        subjectId,
        title,
        type: 'TASK',
        ...inBogota(offset),
      });
      if (status) await page.request.patch(`/api/activities/${a.id}`, { data: { status } });
    }
    const done = await apiCreateActivity(page, {
      subjectId: redes!.id,
      title: 'Tarea entregada',
      type: 'TASK',
      ...inBogota(3 * D),
    });
    await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } });
    return { redes: redes!, titles: rows.map((r) => r[1]) };
  }

  test('each block answers its own question: nothing the hero says is said again', async ({
    page,
  }) => {
    const assertClean = watch(page);
    const { titles } = await seed(page);
    await page.goto('/dashboard');
    const hero = region(page, '¿Qué hago ahora?');
    await expect(hero.getByRole('article').first()).toBeVisible();

    // the hero and its P9-1 actions are still there
    const first = hero
      .locator('[aria-roledescription="actividad"]:not([inert])')
      .getByRole('article');
    await expect(first).toContainText('Informe atrasado');
    await expect(first.getByRole('button', { name: 'Completar: Informe atrasado' })).toBeVisible();

    // no activity title is written more than once on screen
    for (const t of titles) expect(await visibleCount(page, t), t).toBeLessThanOrEqual(1);

    // no second "next delivery", and each counter concept appears once
    await expect(region(page, 'Próxima entrega')).toHaveCount(0);
    const counters = region(page, 'Resumen del periodo');
    await expect(counters.getByRole('link')).toHaveText([/Pendientes/, /En proceso/]);
    await expect(page.getByText('Vencidas', { exact: true })).toHaveCount(1); // the Radar tile
    await expect(page.getByText('Finalizadas', { exact: true })).toHaveCount(0);
    await expect(region(page, 'Progreso de actividades')).toContainText(
      /\d+ de \d+ actividades finalizadas/,
    );

    // the blocks that remain, one question each
    const headings = await page
      .getByRole('heading', { level: 2 })
      .evaluateAll((hs) => hs.map((h) => h.textContent!.trim()));
    expect(headings).toEqual(
      expect.arrayContaining([
        '¿Qué hago ahora?',
        'Resumen del periodo',
        'Progreso de actividades',
        'Captura rápida',
        'Radar académico',
        'Esta semana',
      ]),
    );
    expect(headings).not.toContain('Próxima entrega');
    expect(headings.filter((h) => h === 'Vencidas')).toHaveLength(0);

    // the full views stay one tap away
    await expect(
      region(page, 'Radar académico').getByRole('link', { name: 'Ver el Radar completo' }),
    ).toBeVisible();
    await expect(
      region(page, 'Progreso de actividades').getByRole('link', {
        name: 'Ver progreso por asignatura',
      }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Accesos rápidos' })).toBeVisible();
    assertClean();
  });

  test('the companion names the next class, never an activity', async ({ page }) => {
    test.skip(minutesNow() >= 23 * 60 + 20, 'a 23:30 class is not "next" this late in the day');
    const assertClean = watch(page);
    const { redes, titles } = await seed(page);
    const res = await page.request.post('/api/schedule', {
      data: {
        type: 'CLASS',
        subjectId: redes.id,
        title: 'Redes de Computadores',
        date: bogotaToday(0),
        startTime: '23:30',
        endTime: '23:45',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    await page.goto('/dashboard');
    await expect(companion(page)).toContainText(
      /Tu próxima clase es Redes de Computadores a las 11:30\s?p\.\s?m\./,
    );
    for (const t of titles) await expect(companion(page)).not.toContainText(t);
    assertClean();
  });

  test('once today is over it says so; with no class today it says nothing about classes', async ({
    page,
  }) => {
    test.skip(minutesNow() < 10, 'a 00:00 class has not ended in the first minutes of the day');
    await newUser(page);
    await page.goto('/subjects');
    await addSubjectViaUi(page, 'Redes');
    const [redes] = await apiSubjects(page);
    await apiCreateActivity(page, {
      subjectId: redes!.id,
      title: 'Algo pendiente',
      type: 'TASK',
      ...inBogota(3 * D),
    });
    await page.goto('/dashboard');
    await expect(companion(page)).toBeVisible();
    await expect(companion(page)).not.toContainText(/clase/);

    const res = await page.request.post('/api/schedule', {
      data: {
        type: 'CLASS',
        subjectId: redes!.id,
        title: 'Redes',
        date: bogotaToday(0),
        startTime: '00:00',
        endTime: '00:05',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    await page.goto('/dashboard');
    await expect(companion(page)).toContainText('Hoy no quedan clases.');
  });

  for (const [name, size] of [
    ['360', { width: 360, height: 800 }],
    ['768', { width: 768, height: 1000 }],
    ['1366', { width: 1366, height: 800 }],
  ] as const) {
    test(`stays clean at ${name} px`, async ({ page }) => {
      await page.setViewportSize(size);
      await seed(page);
      await page.goto('/dashboard');
      await expect(region(page, '¿Qué hago ahora?').getByRole('article').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});
