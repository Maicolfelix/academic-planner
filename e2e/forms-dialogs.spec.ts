import AxeBuilder from '@axe-core/playwright';
import { SUBJECT_COLOR_NAMES, SUBJECT_COLOR_VALUES } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  completeOnboarding,
  daysFromNow,
  entrancesDone,
  expectNoHorizontalOverflow,
  openActivityMenu,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** UX1-4: forms and dialogs in the language of Pulso Ambiental. Behavior by state, never by a sleep. */

const PHONE = (page: Page) => page.viewportSize()!.width < 1024;

async function student(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  const [redes] = await apiSubjects(page);
  const bio = await apiCreateSubject(page, 'Bioestadística');
  return { redes: redes!, bio };
}

const axe = async (page: Page, label: string) => {
  await entrancesDone(page); // axe must read the final colors, not a fade
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    label,
  ).toEqual([]);
};

test('creating an activity: errors are said in words next to the field, then it saves', async ({
  page,
}) => {
  const assertClean = watch(page);
  await student(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();

  for (const [field, message] of [
    ['Título', 'Ingresa un título.'],
    ['Asignatura', 'Elige una asignatura.'],
    ['Fecha', 'Ingresa una fecha válida.'],
  ] as const) {
    const control = dialog.getByLabel(field, { exact: true });
    await expect(control).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByText(message)).toBeVisible(); // the word, not only the color
    const id = await control.getAttribute('id');
    await expect(control).toHaveAttribute('aria-describedby', new RegExp(`${id}-error`));
  }

  await dialog.getByLabel('Título', { exact: true }).fill('Taller de redes');
  await dialog.getByLabel('Asignatura', { exact: true }).selectOption({ label: 'Redes' });
  await dialog.getByLabel('Fecha', { exact: true }).fill(daysFromNow(5));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Actividad creada.' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Taller de redes' })).toBeVisible();
  assertClean();
});

test('"Más opciones" is a native disclosure: closed at first, it opens by tap and by keyboard', async ({
  page,
}) => {
  await student(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  const details = dialog.locator('details');
  const summary = details.locator('summary');

  await expect(details).not.toHaveAttribute('open', '');
  await expect(dialog.getByLabel('Hora (opcional)')).toBeHidden();
  // the LAYOUT height (the dialog may still be entering with a transform, which can read 43.99994 in a bounding box)
  expect(
    await summary.evaluate((el) => (el as HTMLElement).offsetHeight),
    'a 44 px row',
  ).toBeGreaterThanOrEqual(44);

  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(dialog.getByLabel('Hora (opcional)')).toBeVisible();
  // the chevron turned (Tailwind v4 writes `rotate` as its own property, not inside `transform`)
  await expect
    .poll(() => details.locator('summary svg').evaluate((el) => getComputedStyle(el).rotate), {
      timeout: 3000,
    })
    .not.toBe('none');

  await summary.focus();
  await page.keyboard.press('Enter'); // keyboard closes it again
  await expect(details).not.toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(details).toHaveAttribute('open', '');
});

test('the controls stay native: date and time pickers, selects and a textarea', async ({
  page,
}) => {
  await student(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.locator('summary').click();
  await expect(dialog.locator('input[type="date"]#activity-date')).toBeVisible();
  await expect(dialog.locator('input[type="time"]#activity-time')).toBeVisible();
  for (const id of ['activity-subject', 'activity-type', 'activity-priority'])
    await expect(dialog.locator(`select#${id}`)).toBeVisible();
  await expect(dialog.locator('textarea#activity-description')).toBeVisible();
  // …and every one is a comfortable target
  for (const el of await dialog
    .locator('input:not([type=hidden]), select, textarea, summary')
    .all())
    expect(await el.evaluate((n) => (n as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
});

test('editing an activity keeps its state beside the date and the reminders inside the same surface', async ({
  page,
}) => {
  const assertClean = watch(page);
  const { redes } = await student(page);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Proyecto final',
    dueDate: daysFromNow(12),
    dueTime: '10:00',
  });
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Editar Proyecto final' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(dialog.getByLabel('Estado', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Título', { exact: true })).toHaveValue('Proyecto final');

  const reminders = dialog.getByRole('region', { name: 'Recordatorios' });
  await expect(reminders).toBeVisible();
  await reminders.getByRole('button', { name: '+ Agregar recordatorio' }).click();
  await reminders.getByLabel('Fecha del recordatorio').fill(daysFromNow(3));
  await reminders.getByLabel('Hora del recordatorio').fill('09:00');
  await reminders.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(reminders.getByText('Manual')).toBeVisible();
  // adding it hides the editor and brings the button back
  await expect(reminders.getByRole('button', { name: '+ Agregar recordatorio' })).toBeVisible();
  assertClean();
});

test('the dialog keeps the keyboard inside, asks before throwing away what was typed, and gives focus back', async ({
  page,
}) => {
  await student(page);
  await page.goto('/activities');
  const opener = page.getByRole('button', { name: 'Agregar actividad' }).first();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });

  // nothing typed: Escape closes at once and the focus returns to the button that opened it
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  const again = page.getByRole('dialog', { name: 'Agregar actividad' });
  await again.getByLabel('Título', { exact: true }).fill('Algo');
  await page.keyboard.press('Escape'); // typed: the form keeps a draft, so it closes without asking and loses nothing
  await expect(again).toHaveCount(0);
  await page.getByRole('button', { name: 'Retomar' }).click();
  await expect(again.getByLabel('Título', { exact: true })).toHaveValue('Algo');

  // Tab never reaches the page behind: every stop is inside the dialog (or, at the end of the loop, the browser's own
  // interface, which Chrome visits and then returns from: `document.body` is the active element then)
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    const ok = await again.evaluate(
      (el) => document.activeElement === document.body || el.contains(document.activeElement),
    );
    expect(ok, `Tab ${i + 1}`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(
    await again.evaluate(
      (el) => document.activeElement === document.body || el.contains(document.activeElement),
    ),
  ).toBe(true);
});

test('a subject shows its tile live, and the palette is a real radio group you can walk with the arrows', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await page.goto('/subjects');
  await page.getByRole('button', { name: 'Agregar asignatura' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar asignatura' });
  const tile = dialog.locator('[data-subject-preview]');

  await dialog.getByLabel('Nombre', { exact: true }).fill('Bases de Datos');
  await expect(tile).toHaveText('BD'); // the letters follow the name

  const [first, second] = SUBJECT_COLOR_VALUES;
  const rgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const radios = dialog.getByRole('radio');
  await expect(radios).toHaveCount(SUBJECT_COLOR_VALUES.length);
  await entrancesDone(page); // a forced click does not wait for the dialog to stop rising
  await radios.first().focus();
  await radios.first().check({ force: true });
  await expect(tile).toHaveCSS('background-color', rgb(first!));
  await page.keyboard.press('ArrowRight'); // a native radio group: the arrows move the choice
  await expect(radios.nth(1)).toBeChecked();
  await expect(tile).toHaveCSS('background-color', rgb(second!));
  // every swatch can be told by its name
  await expect(dialog.getByRole('radio', { name: SUBJECT_COLOR_NAMES[second!] })).toBeChecked();

  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Bases de Datos' })).toBeVisible();
  assertClean();
});

test('a destructive confirmation asks the same way everywhere: Cancelar first, then a danger button', async ({
  page,
}) => {
  const { redes } = await student(page);
  await apiCreateActivity(page, { subjectId: redes.id, title: 'Quiz', dueDate: daysFromNow(4) });
  await page.goto('/activities');
  await openActivityMenu(page, 'Quiz');
  await page.getByRole('menuitem', { name: 'Eliminar Quiz' }).click();
  const dialog = page.getByRole('dialog', { name: '¿Eliminar Quiz?' });
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  const [cancel, danger] = [
    await dialog.getByRole('button', { name: 'Cancelar' }).boundingBox(),
    await dialog.getByRole('button', { name: 'Eliminar', exact: true }).boundingBox(),
  ];
  expect(cancel!.x, 'Cancelar comes before').toBeLessThan(danger!.x);
  await expect(dialog.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCSS(
    'background-color',
    'rgb(180, 35, 24)',
  );
});

test('the schedule block form is grouped, native and cancellable', async ({ page }) => {
  await student(page);
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Agregar bloque' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar bloque' });
  for (const label of ['Tipo', 'Asignatura', 'Título', 'Día', 'Inicio', 'Fin', 'Hasta'])
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Repetir semanalmente' })).toBeChecked();
  await expect(dialog.locator('input[type="time"]#block-start')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
});

test('on a small screen the dialog fits, scrolls inside and keeps its buttons reachable; on a wide one it is not huge', async ({
  page,
}) => {
  const { redes } = await student(page);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title: 'Proyecto final',
    dueDate: daysFromNow(12),
    dueTime: '10:00',
    description: 'Una descripción.',
  });
  await page.setViewportSize(
    PHONE(page) ? { width: 320, height: 568 } : { width: 1366, height: 768 },
  );
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Editar Proyecto final' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await entrancesDone(page);

  const vp = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'a margin below, never flush with the edge').toBeLessThanOrEqual(
    vp.height - 8,
  );
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  const m = await dialog.evaluate((el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
    sh: el.scrollHeight,
    ch: el.clientHeight,
  }));
  expect(m.sw, 'no sideways scroll inside').toBeLessThanOrEqual(m.cw);
  if (PHONE(page)) {
    expect(m.sh, 'taller than the screen: it scrolls inside').toBeGreaterThan(m.ch);
    // the save button is reachable and the dialog (not the page) receives the tap
    const save = dialog.getByRole('button', { name: 'Guardar cambios' });
    await save.scrollIntoViewIfNeeded();
    const p = (await save.boundingBox())!;
    expect(
      await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('dialog'), {
        x: p.x + p.width / 2,
        y: p.y + p.height / 2,
      }),
    ).toBe(true);
  } else {
    expect(box.width, 'a comfortable width, not a slab').toBeLessThanOrEqual(31 * 16 + 2);
    expect(box.width).toBeGreaterThanOrEqual(400);
  }
  await expectNoHorizontalOverflow(page);
});

test('with reduced motion the dialog and the disclosure have nothing left running', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await student(page);
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.locator('summary').click();
  await expect(dialog.getByLabel('Hora (opcional)')).toBeVisible();
  const duration = await dialog.evaluate((el) =>
    parseFloat(getComputedStyle(el).animationDuration),
  );
  expect(duration).toBeLessThan(0.001);
  await entrancesDone(page);
  expect(
    await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    ),
  ).toBe(0);
});

test('forms and dialogs pass axe and fit the screen (errors, more options, reminders, subject, block, delete)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { redes } = await student(page);
  await apiCreateActivity(page, {
    subjectId: redes.id,
    title:
      'Entrega final del proyecto integrador: documento de arquitectura, manual de usuario y pruebas',
    dueDate: daysFromNow(12),
    dueTime: '10:00',
    description: 'Una descripción larga para comprobar el ajuste.',
  });

  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click(); // errors
  await axe(page, 'activity form with errors');
  await dialog.locator('summary').click();
  await axe(page, 'activity form with more options');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  const discard = page.getByRole('button', { name: 'Descartar cambios' });
  if (await discard.count()) await discard.click();

  await page.getByRole('button', { name: /^Editar Entrega final/ }).click();
  dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await dialog.getByRole('button', { name: '+ Agregar recordatorio' }).click();
  await axe(page, 'activity edit with reminders and the reminder editor');
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  if (await discard.count()) await discard.click();

  await page.goto('/subjects');
  await page.getByRole('button', { name: 'Agregar asignatura' }).first().click();
  await page
    .getByRole('dialog', { name: 'Agregar asignatura' })
    .getByLabel('Nombre', { exact: true })
    .fill('Bases');
  await page.getByRole('dialog', { name: 'Agregar asignatura' }).locator('summary').click();
  await axe(page, 'subject form');
  await page.keyboard.press('Escape');
  if (await discard.count()) await discard.click();

  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Agregar bloque' }).first().click();
  await axe(page, 'schedule block form');
});
