import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  entrancesDone,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** The activity card: its main actions are visible (Completar, Editar, Calendario); only Eliminar waits in the menu. */

async function withCards(page: Page, titles: string[]) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes de Computadores');
  const [subject] = await apiSubjects(page);
  for (const [i, title] of titles.entries()) {
    await apiCreateActivity(page, {
      subjectId: subject!.id,
      title,
      type: i % 2 ? 'EXAM' : 'TASK',
      priority: i % 3 === 0 ? 'HIGH' : 'MEDIUM',
      dueDate: daysFromNow(2 + i),
      ...(i % 2 ? { dueTime: '14:00' } : {}),
    });
  }
  await page.goto('/activities');
  await expect(page.getByRole('heading', { name: 'Actividades', level: 1 })).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });

test('the three main actions are visible on every card; Eliminar (and only it) is in the menu', async ({
  page,
}) => {
  const assertClean = watch(page);
  await withCards(page, ['Tarea 1', 'Parcial 2']);
  for (const title of ['Tarea 1', 'Parcial 2']) {
    const c = card(page, title);
    await expect(c.getByRole('button', { name: `Completar ${title}` })).toBeVisible();
    await expect(c.getByRole('button', { name: `Editar ${title}` })).toBeVisible();
    await expect(c.getByRole('button', { name: `Añadir al calendario: ${title}` })).toBeVisible();
    await expect(c.getByRole('button', { name: `Más acciones: ${title}` })).toBeVisible();
    // not duplicated inside the menu
    await c.getByRole('button', { name: `Más acciones: ${title}` }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Eliminar']);
    await expect(page.getByRole('menuitem', { name: /calendario/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  assertClean();
});

for (const width of [320, 390, 430, 768, 1366]) {
  test(`at ${width} px: no overflow, every action is a 44 px target, the card is compact, axe passes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await withCards(page, [
      'Tarea 1',
      'Parcial de Redes con un título bastante largo para comprobar el ajuste',
      'Quiz 3',
      'Proyecto 4',
    ]);
    await expectNoHorizontalOverflow(page);
    for (const c of await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading') })
      .all()) {
      for (const b of await c.getByRole('button').all()) {
        const box = (await b.boundingBox())!;
        const name = (await b.getAttribute('aria-label')) ?? (await b.innerText());
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(43.5);
        expect(box.width, `${name} width`).toBeGreaterThanOrEqual(43.5);
        expect(box.x + box.width, `${name} stays inside the viewport`).toBeLessThanOrEqual(width);
      }
    }
    // what each width shows: labels give way to icons on a phone, never the accessible names
    const cal = card(page, 'Tarea 1').getByRole('button', { name: /^Añadir al calendario/ });
    await expect(cal).toBeVisible();
    await expect(cal.getByText('Calendario')).toBeVisible({ visible: width >= 640 });
    const edit = card(page, 'Tarea 1').getByRole('button', { name: /^Editar/ });
    await expect(edit.getByText('Editar')).toBeVisible({ visible: width >= 420 });

    const height = (await card(page, 'Tarea 1').boundingBox())!.height;
    console.info(`card height at ${width} px: ${Math.round(height)} px`);
    expect(height).toBeLessThan(width < 420 ? 230 : 190);

    await entrancesDone(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('on a phone, more cards fit in the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withCards(page, ['Tarea 1', 'Parcial 2', 'Quiz 3', 'Proyecto 4', 'Lectura 5']);
  const visible = await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading') })
    .evaluateAll(
      (els) => els.filter((e) => e.getBoundingClientRect().bottom <= window.innerHeight).length,
    );
  console.info(`cards fully visible in the first 390 × 844 screen: ${visible}`);
  expect(visible).toBeGreaterThanOrEqual(2);
});
