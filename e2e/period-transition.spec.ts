import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  bogotaToday,
  entrancesDone,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * P9-3: changing semester is changing the CURRENT period of a study. The editor already existed (Mis estudios → Periodos); here it
 * is checked end to end: nothing is closed or deleted, only the current one of THAT study moves, and the Home follows.
 */
test.setTimeout(120_000);

const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };

const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};
const get = async (page: Page, path: string) => {
  const res = await page.request.get(path);
  expect(res.status(), path).toBe(200);
  return res.json();
};

type P = { id: string; name: string; isCurrent: boolean; startDate: string; endDate: string };
const periodsOf = async (page: Page): Promise<P[]> => (await get(page, '/api/periods')).periods;
const byName = (list: P[], name: string) => list.find((p) => p.name === name)!;

const studyCard = (page: Page, name: string) =>
  page.locator('li', { has: page.getByRole('heading', { level: 3, name }) });

async function chooseAction(page: Page, study: string, item: string) {
  await page.getByRole('button', { name: `Más acciones: ${study}`, exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
}

/** Medicina (the main study, 2026-1 current) and Diplomado (Cohorte A current), set up as Mis estudios would. */
async function twoStudies(page: Page) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-1', ...dates },
  });
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Diplomado', type: 'OTHER_ACADEMIC' },
    period: { name: 'Cohorte A', ...dates },
  });
}

test('Medicina changes semester: 2026-1 is kept and no longer current; 2026-2 is current; the Diplomado keeps its own', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);

  await page.goto('/settings/studies');
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: 2026-1');
  await expect(studyCard(page, 'Diplomado')).toContainText('Periodo actual: Cohorte A');

  // the explanation says it in the words of the product, never "close"
  await chooseAction(page, 'Medicina', 'Periodos');
  const list = page.getByRole('dialog', { name: 'Periodos de Medicina' });
  await expect(list).toContainText(
    'El periodo actual de este estudio forma parte de lo que muestra tu Inicio',
  );
  await expect(list).toContainText('también lee los periodos actuales de tus otros estudios');
  await expect(list).toContainText(
    'Para cambiar de semestre, crea el siguiente o marca otro como actual',
  );
  await expect(list).toContainText('el anterior se conserva');
  await expect(list).not.toContainText(/cerrar semestre|eliminar|borrar/i);
  // there is no account-wide current period: nothing may say or suggest it
  await expect(list).not.toContainText(
    /el periodo actual es el que lee|el [uú]nico periodo actual|periodo actual (global|de tu cuenta)|tu periodo actual/i,
  );
  await list.getByRole('button', { name: 'Nuevo periodo' }).click();

  const form = page.getByRole('dialog', { name: 'Nuevo periodo' });
  const checkbox = form.getByRole('checkbox', { name: 'Hacer este el periodo actual' });
  await expect(checkbox).toBeChecked(); // the usual case: the next semester
  await expect(form).toContainText('se conserva y deja de ser el activo; este pasa a serlo');
  await form.getByLabel('Nombre del periodo').fill('2026-2');
  await form.getByLabel('Inicio', { exact: true }).fill(bogotaToday(100));
  await form.getByLabel('Fin', { exact: true }).fill(bogotaToday(200));
  await form.getByRole('button', { name: 'Crear periodo' }).click();

  await expect(
    page
      .getByRole('status')
      .filter({ hasText: '«2026-2» es ahora el periodo actual. El anterior se conserva.' }),
  ).toBeVisible();
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: 2026-2');

  const all = await periodsOf(page);
  expect(byName(all, '2026-2').isCurrent).toBe(true);
  expect(byName(all, '2026-1').isCurrent).toBe(false); // kept, not current
  expect(byName(all, 'Cohorte A').isCurrent).toBe(true); // the other study is untouched
  // there is no "current" per account: one per study
  expect((await get(page, '/api/periods/current')).periods).toHaveLength(2);
  await expect(studyCard(page, 'Diplomado')).toContainText('Periodo actual: Cohorte A');
  assertClean();
});

test('marking an earlier period current moves only that study, and both periods stay in the list', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);
  await page.goto('/settings/studies');

  // next semester first, so there is an earlier one to go back to
  await chooseAction(page, 'Medicina', 'Periodos');
  await page
    .getByRole('dialog', { name: 'Periodos de Medicina' })
    .getByRole('button', { name: 'Nuevo periodo' })
    .click();
  const form = page.getByRole('dialog', { name: 'Nuevo periodo' });
  await form.getByLabel('Nombre del periodo').fill('2026-2');
  await form.getByLabel('Inicio', { exact: true }).fill(bogotaToday(100));
  await form.getByLabel('Fin', { exact: true }).fill(bogotaToday(200));
  await form.getByRole('button', { name: 'Crear periodo' }).click();
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: 2026-2');

  // the dialog says which one is current and which would become it
  await chooseAction(page, 'Medicina', 'Periodos');
  const list = page.getByRole('dialog', { name: 'Periodos de Medicina' });
  await expect(list.getByText('Actual', { exact: true })).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Marcar 2026-2 como periodo actual' })).toHaveCount(
    0,
  );
  await list.getByRole('button', { name: 'Marcar 2026-1 como periodo actual' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: '«2026-1» es ahora el periodo actual. El anterior se conserva.' }),
  ).toBeVisible();
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: 2026-1');

  const all = await periodsOf(page);
  expect(all.map((p) => p.name).sort()).toEqual(['2026-1', '2026-2', 'Cohorte A']); // nothing was deleted
  expect(byName(all, '2026-1').isCurrent).toBe(true);
  expect(byName(all, '2026-2').isCurrent).toBe(false);
  expect(byName(all, 'Cohorte A').isCurrent).toBe(true);
  assertClean();
});

test('a period that is created without making it current changes nothing; a study with none current says it will be', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-1', ...dates },
  });
  await page.goto('/settings/studies');
  await chooseAction(page, 'Medicina', 'Periodos');
  await page
    .getByRole('dialog', { name: 'Periodos de Medicina' })
    .getByRole('button', { name: 'Nuevo periodo' })
    .click();
  const form = page.getByRole('dialog', { name: 'Nuevo periodo' });
  await form.getByRole('checkbox', { name: 'Hacer este el periodo actual' }).uncheck();
  await expect(form).toContainText('Quedará guardado sin cambiar el periodo actual');
  await form.getByLabel('Nombre del periodo').fill('2027-1');
  await form.getByLabel('Inicio', { exact: true }).fill(bogotaToday(200));
  await form.getByLabel('Fin', { exact: true }).fill(bogotaToday(300));
  await form.getByRole('button', { name: 'Crear periodo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Periodo creado.' })).toBeVisible();
  const all = await periodsOf(page);
  expect(byName(all, '2027-1').isCurrent).toBe(false);
  expect(byName(all, '2026-1').isCurrent).toBe(true);
  assertClean();
});

test('editing a period: name, dates and level persist', async ({ page }) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  await post(page, '/api/study-tracks/setup', {
    track: { name: 'Medicina', type: 'UNIVERSITY' },
    period: { name: '2026-1', ...dates },
  });
  await page.goto('/settings/studies');
  await chooseAction(page, 'Medicina', 'Periodos');
  await page
    .getByRole('dialog', { name: 'Periodos de Medicina' })
    .getByRole('button', { name: 'Editar 2026-1' })
    .click();
  const form = page.getByRole('dialog', { name: 'Editar periodo' });
  await expect(form.getByRole('checkbox')).toHaveCount(0); // editing never asks "make it current"
  await form.getByLabel('Nombre del periodo').fill('Primer semestre 2026');
  await form.getByLabel('Inicio', { exact: true }).fill(bogotaToday(-20));
  await form.getByLabel('Fin', { exact: true }).fill(bogotaToday(120));
  await form.getByLabel(/^Nivel/).fill('6');
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Periodo actualizado.' })).toBeVisible();
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: Primer semestre 2026');
  await expect(studyCard(page, 'Medicina')).toContainText('6.º semestre');

  const saved = byName(await periodsOf(page), 'Primer semestre 2026') as P & {
    studyLevel?: number;
  };
  expect(saved.startDate).toBe(bogotaToday(-20));
  expect(saved.endDate).toBe(bogotaToday(120));
  expect(saved.isCurrent).toBe(true);
  await page.reload();
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: Primer semestre 2026');
  assertClean();
});

test('the Home follows: the activities of the period that becomes current appear, those of the other study stay', async ({
  page,
}) => {
  const assertClean = watch(page);
  await twoStudies(page);
  const tracks = (await get(page, '/api/study-tracks')).studyTracks as {
    id: string;
    name: string;
  }[];
  const medicina = tracks.find((t) => t.name === 'Medicina')!;
  const before = await periodsOf(page);
  // Medicina's NEXT semester exists (not current) with an activity of its own; the Diplomado has one in its current period
  const next = (
    await post(page, '/api/periods', {
      name: '2026-2',
      startDate: bogotaToday(100),
      endDate: bogotaToday(200),
      studyTrackId: medicina.id,
    })
  ).period;
  const mk = async (periodId: string, subject: string, title: string, dueDate: string) => {
    const s = (await post(page, '/api/subjects', { periodId, name: subject })).subject;
    await post(page, '/api/activities', { subjectId: s.id, title, type: 'TASK', dueDate });
  };
  await mk(byName(before, 'Cohorte A').id, 'Seguridad', 'Tarea del diplomado', bogotaToday(3));
  await mk(next.id, 'Farmacología', 'Entrega del semestre nuevo', bogotaToday(110));

  await page.goto('/dashboard');
  await entrancesDone(page);
  const hero = page.getByRole('region', { name: '¿Qué hago ahora?' });
  await expect(hero).toContainText('Tarea del diplomado');
  await expect(page.getByText('Entrega del semestre nuevo')).toHaveCount(0); // not current yet

  // go to Mis estudios, make 2026-2 current, come back WITHOUT reloading
  await page.getByRole('link', { name: 'Mis estudios' }).click();
  await expect(page).toHaveURL(/\/settings\/studies$/);
  await chooseAction(page, 'Medicina', 'Periodos');
  await page
    .getByRole('dialog', { name: 'Periodos de Medicina' })
    .getByRole('button', { name: 'Marcar 2026-2 como periodo actual' })
    .click();
  await expect(studyCard(page, 'Medicina')).toContainText('Periodo actual: 2026-2');

  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Inicio' })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(hero).toContainText('Entrega del semestre nuevo');
  await expect(hero).toContainText('Tarea del diplomado'); // the other study is still read
  const current = (await get(page, '/api/periods/current')).periods as {
    period: { name: string };
  }[];
  expect(current.map((c) => c.period.name).sort()).toEqual(['2026-2', 'Cohorte A']);
  assertClean();
});

for (const [name, size] of [
  ['360', { width: 360, height: 800 }],
  ['768', { width: 768, height: 1000 }],
  ['1366', { width: 1366, height: 800 }],
] as const) {
  test(`the periods dialog and its form fit at ${name} px with long names, keep the keyboard and pass axe`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await register(page, uniqueEmail());
    await expect(page).toHaveURL(/\/onboarding$/);
    const long =
      'Un periodo con un nombre bastante largo para probar el ajuste del texto en pantallas pequeñas';
    await post(page, '/api/study-tracks/setup', {
      track: { name: 'Medicina', type: 'UNIVERSITY' },
      period: { name: long, ...dates },
    });
    await page.goto('/settings/studies');
    await chooseAction(page, 'Medicina', 'Periodos');
    const list = page.getByRole('dialog', { name: 'Periodos de Medicina' });
    await expect(list.getByText('Actual', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    for (const button of await list.getByRole('button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    }

    await list.getByRole('button', { name: 'Nuevo periodo' }).click();
    const form = page.getByRole('dialog', { name: 'Nuevo periodo' });
    await form.getByLabel('Nombre del periodo').fill(long);
    await expectNoHorizontalOverflow(page);
    // keyboard: the checkbox is reachable and toggles with Space; its hint is linked to it
    const checkbox = form.getByRole('checkbox', { name: 'Hacer este el periodo actual' });
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toHaveAttribute('aria-describedby', 'period-current-hint');
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    // an invalid form shows its errors in words and keeps the dialog
    await form.getByLabel('Nombre del periodo').fill('');
    await form.getByRole('button', { name: 'Crear periodo' }).click();
    const nameField = form.getByLabel('Nombre del periodo');
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');
    await expect(form.locator('#period-name-error')).toBeVisible(); // said in words, linked to the field
    await expect(nameField).toHaveAttribute('aria-describedby', /period-name-error/);
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
