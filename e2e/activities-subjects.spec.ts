import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  expectNoHorizontalOverflow,
  inBogota,
  openActivityMenu,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** UX1-3: Activities and Subjects in the language of the Home (Pulso Ambiental). Behavior by state, never by a sleep. */

const PHONE = (page: Page) => page.viewportSize()!.width < 1024;
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

async function withActivities(page: Page, count = 4) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [redes] = await apiSubjects(page);
  const bio = await apiCreateSubject(page, 'Bioestadística');
  const soon = inBogota(12 * 3600e3);
  await apiCreateActivity(page, {
    subjectId: redes!.id,
    title: 'Parcial urgente',
    type: 'EXAM',
    priority: 'HIGH',
    dueDate: soon.dueDate,
    dueTime: soon.dueTime,
  });
  for (let i = 1; i < count; i++) {
    await apiCreateActivity(page, {
      subjectId: i % 2 ? bio.id : redes!.id,
      title: `Tarea ${i}`,
      dueDate: daysFromNow(i + 1),
    });
  }
  return { redes: redes!, bio };
}

const box = async (l: Locator) => (await l.boundingBox())!;

test('one primary action completes the activity, with a brief confirmation, and the state control agrees', async ({
  page,
}) => {
  const assertClean = watch(page);
  await withActivities(page);
  await page.goto('/activities');

  const target = card(page, 'Tarea 1');
  await expect(target).toBeVisible();
  await expect(page.getByRole('button', { name: /^Completar / })).toHaveCount(4); // one per open activity
  await target.getByRole('button', { name: 'Completar Tarea 1' }).click();

  const select = target.getByLabel('Cambiar estado de Tarea 1');
  await expect(select).toHaveValue('COMPLETED');
  await expect(target.getByRole('button', { name: 'Completar Tarea 1' })).toHaveCount(0);
  await expect(page.locator('[data-just-completed]')).toHaveCount(1);
  await expect(page.locator('[data-just-completed]')).toHaveCount(0, { timeout: 5000 }); // a moment, not a state
  assertClean();
});

test('the state control is still a native select with the three exact states', async ({ page }) => {
  await withActivities(page);
  await page.goto('/activities');
  const select = card(page, 'Tarea 2').getByLabel('Cambiar estado de Tarea 2');
  await expect(select.locator('option')).toHaveText(['Pendiente', 'En proceso', 'Finalizada']);
  await select.selectOption({ label: 'En proceso' });
  await expect(select).toHaveValue('IN_PROGRESS');
  await expect(
    card(page, 'Tarea 2').getByRole('button', { name: 'Completar Tarea 2' }),
  ).toBeVisible();
});

test('the "more actions" menu works from the keyboard and never hides what it holds', async ({
  page,
}) => {
  const assertClean = watch(page);
  await withActivities(page);
  await page.goto('/activities');

  const trigger = page.getByRole('button', { name: 'Más acciones: Tarea 1', exact: true });
  await trigger.focus();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: 'Más acciones: Tarea 1' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Añadir al calendario', 'Eliminar']);
  await expect(menu.getByRole('menuitem', { name: 'Añadir al calendario: Tarea 1' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Eliminar Tarea 1' })).toBeFocused();
  await page.keyboard.press('ArrowDown'); // wraps
  await expect(menu.getByRole('menuitem', { name: 'Añadir al calendario: Tarea 1' })).toBeFocused();
  // each item is a 44 px target; deleting is told apart by its color and its word
  for (const b of await menu.getByRole('menuitem').all())
    expect(await b.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44); // layout height: the menu may still be entering

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // a click anywhere else closes it
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(menu).toHaveCount(0);
  assertClean();
});

test('delete is still confirmed, from the menu, and Cancel leaves everything as it was', async ({
  page,
}) => {
  const assertClean = watch(page);
  await withActivities(page);
  await page.goto('/activities');

  await openActivityMenu(page, 'Tarea 2');
  await page.getByRole('menuitem', { name: 'Eliminar Tarea 2' }).click();
  const dialog = page.getByRole('dialog', { name: '¿Eliminar Tarea 2?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused(); // the safe choice is the default
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page, 'Tarea 2')).toBeVisible();
  // the focus came back to the button that opened it, which still exists
  await expect(
    page.getByRole('button', { name: 'Más acciones: Tarea 2', exact: true }),
  ).toBeFocused();

  await openActivityMenu(page, 'Tarea 2');
  await page.getByRole('menuitem', { name: 'Eliminar Tarea 2' }).click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Tarea 2?' })
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await expect(card(page, 'Tarea 2')).toHaveCount(0);
  assertClean();
});

test('Edit opens the editor of that activity', async ({ page }) => {
  await withActivities(page);
  await page.goto('/activities');
  await card(page, 'Tarea 3').getByRole('button', { name: 'Editar Tarea 3' }).click();
  await expect(page.getByRole('dialog', { name: 'Editar actividad' })).toBeVisible();
  await expect(page.getByLabel('Título')).toHaveValue('Tarea 3');
});

test('the Radar mark of a card is a dot and a word, never an emoji, and it does not move', async ({
  page,
}) => {
  await withActivities(page);
  await page.goto('/activities');
  const urgent = card(page, 'Parcial urgente');
  await expect(urgent).toContainText('Atención inmediata');
  expect(await urgent.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  // nothing inside the list loops: a long list cannot be a pile of running animations
  const looping = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => (a.effect?.getTiming().iterations ?? 1) === Infinity)
        .filter((a) => (a.effect as KeyframeEffect).target?.closest('ul') !== null).length,
  );
  expect(looping).toBe(0);
});

test('the state filters scroll sideways on a phone and keep the chosen one in view', async ({
  page,
}) => {
  test.skip(!PHONE(page), 'the row only overflows on a phone');
  await withActivities(page);
  await page.goto('/activities');
  const group = page.getByRole('group', { name: 'Estado' });
  const metrics = await group.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(metrics.scroll, 'the five states do not fit: the row scrolls').toBeGreaterThan(
    metrics.client,
  );
  await expectNoHorizontalOverflow(page); // …and the page itself does not

  const last = group.getByRole('button', { name: 'Vencidas', exact: true });
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () => {
        const [g, b] = [await box(group), await box(last)];
        return b.x >= g.x - 1 && b.x + b.width <= g.x + g.width + 1;
      },
      { timeout: 3000 },
    )
    .toBe(true);
});

test('the other filters sit in one soft panel: behind "Más filtros" on a phone, always there on a wide screen', async ({
  page,
}) => {
  await withActivities(page);
  await page.goto('/activities');

  if (PHONE(page)) {
    const toggle = page.getByRole('button', { name: /^Más filtros/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Prioridad')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByLabel('Prioridad').selectOption({ label: 'Alta' });
    await expect(page).toHaveURL(/priority=HIGH/);
    await expect(toggle).toContainText('1 activo');

    // a link or a reload with a filter applied arrives with the panel already open
    await page.reload();
    await expect(page.getByRole('button', { name: /^Más filtros/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByLabel('Prioridad')).toHaveValue('HIGH');
  } else {
    await expect(page.getByRole('button', { name: /^Más filtros/ })).toHaveCount(0);
    for (const label of ['Asignatura', 'Prioridad', 'Tipo', 'Radar'])
      await expect(page.getByLabel(label)).toBeVisible();
  }
});

test('Activities use the width of a wide screen (two columns) and stay one column on a phone', async ({
  page,
}) => {
  await withActivities(page, 5);
  await page.goto('/activities');
  const first = await box(page.getByRole('listitem').nth(0));
  const second = await box(page.getByRole('listitem').nth(1));
  if (PHONE(page)) {
    expect(second.y, 'one column').toBeGreaterThan(first.y + first.height - 1);
    expect(Math.abs(second.x - first.x)).toBeLessThan(2);
  } else {
    expect(Math.abs(second.y - first.y), 'two columns: the same row').toBeLessThan(2);
    expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    expect((await box(page.locator('main'))).width).toBeGreaterThan(900);
  }
  await expectNoHorizontalOverflow(page);
});

test('Subjects are spaces with a face of their own, in a grid that uses the width', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Bases de Datos');
  await apiCreateSubject(page, 'Redes');
  await apiCreateSubject(
    page,
    'Una asignatura con un nombre bastante largo para probar el ajuste de línea',
  );
  await page.goto('/subjects');

  const bases = card(page, 'Bases de Datos');
  await expect(bases).toBeVisible();
  await expect(bases.getByText('BD', { exact: true })).toBeVisible(); // the monogram (decoration, but visible)
  for (const name of ['Editar', 'Eliminar'])
    expect(
      (await box(bases.getByRole('button', { name: new RegExp(`^${name} Bases`) }))).height,
    ).toBeGreaterThanOrEqual(44);

  const [a, b, c] = [
    await box(page.getByRole('listitem').nth(0)),
    await box(page.getByRole('listitem').nth(1)),
    await box(page.getByRole('listitem').nth(2)),
  ];
  if (PHONE(page)) {
    expect(Math.abs(a.x - b.x), 'one column on a phone').toBeLessThan(2);
  } else {
    expect(
      Math.abs(a.y - b.y) + Math.abs(b.y - c.y),
      'three in a row on a wide screen',
    ).toBeLessThan(4);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    expect(c.x).toBeGreaterThan(b.x + b.width - 1);
  }
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('editing and deleting a subject still work from the new card', async ({ page }) => {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  await page.goto('/subjects');

  await page.getByRole('button', { name: 'Editar Redes' }).click();
  const dialog = page.getByRole('dialog', { name: /Editar asignatura/ });
  await dialog.getByLabel('Nombre').fill('Redes y Comunicaciones');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(card(page, 'Redes y Comunicaciones')).toBeVisible();

  await page.getByRole('button', { name: 'Eliminar Redes y Comunicaciones' }).click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Redes y Comunicaciones?' })
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await expect(card(page, 'Redes y Comunicaciones')).toHaveCount(0);
});

test('with reduced motion the new screens have nothing running and nothing missing', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await withActivities(page);
  await page.goto('/activities');
  await expect(page.getByRole('listitem')).toHaveCount(4);
  const running = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => (a.effect?.getTiming().iterations ?? 1) === Infinity)
        .length,
  );
  expect(running, 'no infinite animation').toBe(0);
  await page.getByRole('button', { name: 'Completar Tarea 1' }).click();
  await expect(card(page, 'Tarea 1').getByLabel('Cambiar estado de Tarea 1')).toHaveValue(
    'COMPLETED',
  );
});

test('Activities (with a menu open, a long title and 12 cards) and Subjects fit the screen and pass axe', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { redes } = await withActivities(page, 11);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title:
      'Entrega final del proyecto integrador: documento de arquitectura, manual de usuario y pruebas',
    dueDate: daysFromNow(20),
    description:
      'Una descripción larga que ocupa varias líneas para comprobar el recorte de la tarjeta y el ajuste.',
  });
  const axe = async (label: string) => {
    await page.waitForTimeout(700); // let the entrances finish: axe must read the final colors
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      label,
    ).toEqual([]);
  };

  await page.goto('/activities');
  await expect(page.getByRole('listitem')).toHaveCount(12);
  await expectNoHorizontalOverflow(page);
  await axe('activities');

  await openActivityMenu(page, 'Parcial urgente');
  await expect(page.getByRole('menu')).toBeVisible();
  await axe('activities with a menu open');
  await page.keyboard.press('Escape');

  if (PHONE(page)) await page.getByRole('button', { name: /^Más filtros/ }).click();
  await page.getByLabel('Prioridad').selectOption({ label: 'Alta' });
  await axe('activities with filters');

  await page.goto('/subjects');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe('subjects');
});
