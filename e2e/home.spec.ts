import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  inBogota,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** UX1-2: the redesigned Home. What to do now, then how am I doing, then what comes next. */

const region = (page: Page, name: string) => page.getByRole('region', { name });

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  return (await apiSubjects(page))[0]!;
}

test('the hero comes first, then how am I doing, then what comes next (two columns on a wide screen)', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const bio = await apiCreateSubject(page, 'Bioestadística');
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Entrega atrasada',
    dueDate: daysFromNow(-2),
  });
  await apiCreateActivity(page, { subjectId: bio.id, title: 'Taller', dueDate: daysFromNow(3) });
  await apiCreateActivity(page, { subjectId: bio.id, title: 'Lectura', dueDate: daysFromNow(6) });

  await page.goto('/dashboard');
  await expect(region(page, '¿Qué hago ahora?').getByRole('article')).toBeVisible();

  const names = [
    '¿Qué hago ahora?',
    'Resumen del periodo',
    'Progreso de actividades',
    'Captura rápida',
    'Radar académico',
    'Esta semana',
  ];
  const top = async (name: string) => (await region(page, name).boundingBox())!.y;
  const left = async (name: string) => (await region(page, name).boundingBox())!.x;

  // The DOM (and so the keyboard and the screen reader) always reads: hero > counters > progress > capture > Radar > week.
  const handles = await Promise.all(names.map((n) => region(page, n).elementHandle()));
  const inDomOrder = await page.evaluate(
    (els) =>
      els.every(
        (el, i) =>
          i === 0 ||
          (els[i - 1]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    handles,
  );
  expect(inDomOrder, 'reading order').toBe(true);

  if ((page.viewportSize()?.width ?? 0) < 1024) {
    // phone and tablet: one column, in that same order
    const order = await Promise.all(names.map(top));
    expect(order, 'hero > counters > progress > capture > Radar > week').toEqual(
      [...order].sort((a, b) => a - b),
    );
  } else {
    // desktop: two columns. Left: what to do now, then what is next. Right: how am I doing, the capture and the Radar.
    const [heroX, heroW] = [
      await left(names[0]!),
      (await region(page, names[0]!).boundingBox())!.width,
    ];
    for (const n of names.slice(1, 5))
      expect(await left(n), `${n} sits beside the hero`).toBeGreaterThan(heroX + heroW);
    expect(await left(names[5]!), 'the week stays under the hero').toBeCloseTo(heroX, 0);
    const right = await Promise.all(names.slice(1, 5).map(top));
    expect(right, 'counters > progress > capture > Radar, one under the other').toEqual(
      [...right].sort((a, b) => a - b),
    );
    expect(await top(names[5]!), 'the week comes after the hero').toBeGreaterThan(
      await top(names[0]!),
    );
    // the desktop uses the width: the content is wider than the old 768 px reading column
    expect((await page.locator('main').boundingBox())!.width).toBeGreaterThan(900);
  }
  // exactly one h1, every section title an h2
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const levels = await page
    .getByRole('heading')
    .evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  expect(levels.slice(1).every((l) => l === 2)).toBe(true);
  assertClean();
});

test('an urgent activity is the hero: state in words, subject, deadline, reasons and a link to it', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Parcial de Redes',
    type: 'EXAM',
    priority: 'HIGH',
    ...inBogota(12 * 3600e3),
  });

  await page.goto('/dashboard');
  const hero = region(page, '¿Qué hago ahora?');
  const article = hero.getByRole('article', { name: 'Parcial de Redes' });
  await expect(article).toBeVisible();
  await expect(article).toContainText('Atención inmediata'); // the state is a word, not a color
  await expect(article).toContainText('Redes');
  await expect(article).toContainText(/Vence en \d+ horas?/);
  await expect(hero.getByRole('list').getByRole('listitem').first()).toBeVisible();

  await hero.getByRole('link', { name: /Ver actividad/ }).click();
  await expect(page).toHaveURL(/\/activities\?edit=/);
  await expect(page.getByRole('dialog', { name: 'Editar actividad' })).toBeVisible();
  assertClean();
});

test('the counters and the five Radar tiles are links to the filtered lists', async ({ page }) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  await apiCreateActivity(page, { subjectId: redes.id, title: 'Vieja', dueDate: daysFromNow(-3) });
  await apiCreateActivity(page, { subjectId: redes.id, title: 'Nueva', dueDate: daysFromNow(9) });
  await page.goto('/dashboard');

  const counters = region(page, 'Resumen del periodo');
  await expect(counters.getByRole('link')).toHaveCount(4);
  await counters.getByRole('link', { name: /Vencidas/ }).click();
  await expect(page).toHaveURL(/\/activities\?overdue=true$/);

  await page.goto('/dashboard');
  const radar = region(page, 'Radar académico');
  await expect(radar.getByRole('listitem')).toHaveCount(5);
  for (const label of [
    'Vencidas',
    'Atención inmediata',
    'Próximas',
    'Planificables',
    'Bajo control',
  ]) {
    await expect(radar.getByText(label, { exact: true })).toBeVisible();
  }
  await radar.getByRole('link', { name: /Vencidas/ }).click();
  await expect(page).toHaveURL(/\/activities\?radar=OVERDUE$/);

  await page.goto('/dashboard');
  await region(page, 'Radar académico')
    .getByRole('link', { name: 'Ver el Radar completo' })
    .click();
  await expect(page).toHaveURL(/\/radar$/);

  await page.goto('/dashboard');
  await region(page, 'Progreso de actividades')
    .getByRole('link', { name: 'Ver progreso por asignatura' })
    .click();
  await expect(page).toHaveURL(/\/progress$/);
  assertClean();
});

test('when the hero is the next delivery, "Próxima entrega" is one quiet line and not a second card', async ({
  page,
}) => {
  const redes = await newUser(page);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Entrega final',
    dueDate: daysFromNow(9),
  });
  await page.goto('/dashboard');

  const next = region(page, 'Próxima entrega');
  await expect(next).toContainText('Entrega final');
  await expect(next).toContainText('Redes');
  await expect(next).toContainText(/Vence en \d+ días/);
  expect(await next.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  expect((await next.boundingBox())!.height, 'a line or two, not a card').toBeLessThan(90);
});

test('progress: the bar says its value, fills once, and with reduced motion is simply at its value', async ({
  page,
}) => {
  const redes = await newUser(page);
  const done = await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Hecha',
    dueDate: daysFromNow(2),
  });
  await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } });
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Pendiente',
    dueDate: daysFromNow(4),
  });

  await page.goto('/dashboard');
  const bar = region(page, 'Progreso de actividades').getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', '50');
  await expect(bar).toHaveAttribute('aria-valuetext', '50%, 1 de 2 actividades finalizadas');
  const fill = bar.locator('div');
  expect(await fill.evaluate((el) => getComputedStyle(el).animationName)).toBe('fill');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  const reduced = await region(page, 'Progreso de actividades')
    .getByRole('progressbar')
    .locator('div')
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        duration: parseFloat(cs.animationDuration),
        delay: parseFloat(cs.animationDelay),
        width: cs.width,
      };
    });
  expect(reduced.duration, 'animation collapsed').toBeLessThan(0.001);
  expect(reduced.delay).toBe(0);
  // …and the fill is at its value, not stuck at the start of the animation
  const widths = await bar.evaluate((el) => [
    el.getBoundingClientRect().width,
    (el.firstElementChild as HTMLElement).getBoundingClientRect().width,
  ]);
  expect(widths[1]! / widths[0]!).toBeCloseTo(0.5, 1);
});

test('the Home keeps working with the bottom navigation and capture in their new places', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  await apiCreateActivity(page, { subjectId: redes.id, title: 'Algo', dueDate: daysFromNow(5) });
  await page.goto('/dashboard');

  const capture = region(page, 'Captura rápida');
  await expect(capture.getByLabel('Escribe la actividad en una frase')).toBeVisible();
  await capture.getByLabel('Escribe la actividad en una frase').fill('   ');
  await capture.getByRole('button', { name: 'Interpretar' }).click();
  await expect(capture.locator('#quick-capture-error')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Interpretar mensaje' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Principal' });
  await nav.getByRole('link', { name: 'Actividades', exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await nav.getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  assertClean();
});

test('a new user without activities sees the empty state, no hero, and can still capture', async ({
  page,
}) => {
  await newUser(page);
  await page.goto('/dashboard');

  await expect(
    page.getByRole('heading', { name: 'Todavía no tienes actividades registradas.' }),
  ).toBeVisible();
  await expect(region(page, '¿Qué hago ahora?')).toHaveCount(0);
  await expect(region(page, 'Radar académico')).toHaveCount(0);
  await expect(region(page, 'Captura rápida')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the Home fits the screen and passes axe with a full week of data', async ({ page }) => {
  const redes = await newUser(page);
  const bio = await apiCreateSubject(page, 'Bioestadística');
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Entrega atrasada',
    dueDate: daysFromNow(-2),
  });
  const soon = inBogota(30 * 3600e3);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Parcial de Redes',
    type: 'EXAM',
    dueDate: soon.dueDate,
    dueTime: soon.dueTime,
  });
  for (let i = 3; i <= 7; i++) {
    await apiCreateActivity(page, {
      subjectId: bio.id,
      title: `Actividad con un título bastante largo número ${i}`,
      dueDate: daysFromNow(i),
    });
  }

  for (const width of [320, 390, 430, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard');
    await expect(region(page, '¿Qué hago ahora?').getByRole('article')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.waitForTimeout(700); // let the entrance finish: axe must read the final colors, not a fade
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});
