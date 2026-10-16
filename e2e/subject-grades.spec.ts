import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { bogotaToday, expectNoHorizontalOverflow, register, uniqueEmail, watch } from './helpers';

/**
 * The grades of a subject (B2). Accounts are prepared through the API (a study, a period of it, subjects): the configuration of the
 * grades and every evaluation go through the screen, as a student would.
 */
test.setTimeout(120_000);

const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };

const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};

/** A study of the given type with a period and the named subjects. */
async function account(
  page: Page,
  type: 'UNIVERSITY' | 'SCHOOL' | 'OTHER_ACADEMIC',
  subjectNames: string[] = ['Farmacología'],
) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  for (const data of [
    { primaryUse: 'PERSONAL', onboardingStatus: 'IN_PROGRESS' },
    { onboardingStatus: 'COMPLETED' },
  ]) {
    expect((await page.request.patch('/api/profile', { data })).status()).toBe(200);
  }
  const study = (await post(page, '/api/study-tracks', { name: 'Mi estudio', type })).studyTrack;
  const period = (
    await post(page, '/api/periods', { name: '2026-2', ...dates, studyTrackId: study.id })
  ).period;
  const subjects = [];
  for (const name of subjectNames)
    subjects.push((await post(page, '/api/subjects', { periodId: period.id, name })).subject);
  return { study, period, subjects };
}

const gradesUrl = (subjectId: string) => `/subjects/${subjectId}/grades`;

const axe = async (page: Page, label: string) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
    `axe violations on ${label}`,
  ).toEqual([]);
};

/** Adds an evaluation through the dialog. `note` fills the plain note; `points` the "earned of max" pair. */
async function addEvaluation(
  page: Page,
  cut: string,
  v: { name: string; weight: string; note?: string; points?: [string, string] },
) {
  await page.getByRole('button', { name: `Agregar evaluación a ${cut}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar evaluación' });
  await dialog.getByLabel('Nombre').fill(v.name);
  await dialog.getByLabel(/^Peso dentro de/).fill(v.weight);
  if (v.points) {
    await dialog.getByRole('radio', { name: 'Puntos' }).check();
    await dialog.getByLabel('Obtenidos').fill(v.points[0]);
    await dialog.getByLabel('De', { exact: true }).fill(v.points[1]);
  }
  if (v.note !== undefined) await dialog.getByRole('textbox', { name: /^Nota/ }).fill(v.note);
  return dialog;
}
const save = async (dialog: ReturnType<Page['getByRole']>, name = 'Agregar') => {
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
};

test('A · university: the first configuration, an evaluation, the current grade and what is needed', async ({
  page,
}) => {
  const check = watch(page, ['400 /api/evaluations']);
  const { subjects } = await account(page, 'UNIVERSITY');
  await page.goto(gradesUrl(subjects[0]!.id));

  // Not configured yet: the empty state says the configuration is shared, and offers one clear action.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Notas de Farmacología' }),
  ).toBeVisible();
  await expect(page.getByText('Configura cómo califican esta materia')).toBeVisible();
  await expect(
    page.getByText('La escala y los cortes se comparten con las demás materias de este periodo.'),
  ).toBeVisible();
  await axe(page, 'grades · empty');

  await page.getByRole('button', { name: 'Configurar notas' }).click();
  const setup = page.getByRole('dialog', { name: 'Configurar notas · Escala' });
  await axe(page, 'grades · setup dialog');
  await expect(setup.getByRole('radio', { name: '0.0–5.0 · aprueba con 3.0' })).toBeChecked();
  await setup.getByRole('button', { name: 'Siguiente' }).click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Cortes' });
  await expect(cuts.getByRole('radio', { name: '30 % / 30 % / 40 %' })).toBeChecked();
  await cuts.getByRole('button', { name: 'Guardar' }).click();
  await expect(cuts).toBeHidden();

  // Configured, nothing graded.
  await expect(page.getByText('Notas configuradas.')).toBeVisible();
  await expect(page.getByTestId('current-grade')).toHaveText('Sin notas todavía');
  await expect(page.getByText('Aprobatoria: 3.0')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Corte 1' })).toBeVisible();
  await expect(page.getByText('30 % de la nota final')).toHaveCount(2);
  await expect(page.getByText('40 % de la nota final')).toBeVisible();

  // A pending evaluation (no note), then a graded one.
  await save(await addEvaluation(page, 'Corte 1', { name: 'Parcial 1', weight: '60' }));
  await expect(page.getByRole('button', { name: 'Registrar nota de Parcial 1' })).toBeVisible();
  await save(await addEvaluation(page, 'Corte 1', { name: 'Taller 1', weight: '40', note: '4.5' }));
  await expect(page.getByLabel('Nota: 4.5')).toBeVisible();

  // Quick grade: only the score, no editing.
  await page.getByRole('button', { name: 'Registrar nota de Parcial 1' }).click();
  const quick = page.getByRole('dialog', { name: 'Nota de Parcial 1' });
  await quick.getByLabel('Nota').fill('3.5');
  await save(quick, 'Guardar nota');
  // Corte 1 is complete: 3.5·60 % + 4.5·40 % = 3.9 → 30 % of the final grade, so the current grade is 3.9.
  await expect(page.getByTestId('current-grade')).toHaveText('3.9');
  await expect(page.getByText('Subtotal: 3.9')).toBeVisible();
  await expect(
    page.getByText('Lo evaluado hasta ahora está por encima de la nota mínima.'),
  ).toBeVisible();
  // The accumulated grade of the subject is another figure: 3.9 on 30 % of the final grade = 1.17 → 1.2.
  await expect(page.getByTestId('accumulated-grade')).toHaveText('1.2');
  // Weights still missing (cuts 2 and 3 have no evaluations): the figures are an estimate, and it says so.
  await expect(page.getByTestId('estimate-note')).toHaveText(
    'Estimación: faltan pesos por definir.',
  );
  await expect(page.getByTestId('required-text')).toContainText('Necesitas aproximadamente');

  // More than 100 % is an inline error on the weight field, and the dialog stays open.
  const over = await addEvaluation(page, 'Corte 1', { name: 'Extra', weight: '10' });
  await over.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(over.getByText(/no pueden sumar más de 100 %/)).toBeVisible();
  await expect(over.getByLabel(/^Peso dentro de/)).toHaveAttribute('aria-invalid', 'true');
  await expect(over).toBeVisible();
  await over.getByRole('button', { name: 'Cancelar' }).click();
  await expect(over).toBeHidden();

  // Edit the weight, move the evaluation to another cut.
  await page.getByRole('button', { name: 'Más acciones: Taller 1' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar evaluación' });
  await edit.getByLabel(/^Peso dentro de/).fill('50');
  await edit.getByLabel('Corte', { exact: true }).selectOption({ label: 'Corte 2' });
  await save(edit, 'Guardar cambios');
  await expect(page.getByRole('region', { name: 'Corte 2' }).getByText('Taller 1')).toBeVisible();

  // Delete asks first and keeps everything else.
  await page.getByRole('button', { name: 'Más acciones: Taller 1' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Eliminar Taller 1?' });
  await expect(confirm.getByText('La actividad enlazada no se borra.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByText('Taller 1')).toHaveCount(0);
  await expect(page.getByText('Parcial 1')).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await axe(page, 'grades · configured');
  check();
});

test('B · school: periodos de evaluación, 1–5 and four periods of 25 %', async ({ page }) => {
  const check = watch(page);
  const { subjects } = await account(page, 'SCHOOL', ['Matemáticas']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await expect(page.getByText('La escala y los periodos de evaluación se comparten')).toBeVisible();

  await page.getByRole('button', { name: 'Configurar notas' }).click();
  const setup = page.getByRole('dialog', { name: 'Configurar notas · Escala' });
  await setup.getByRole('radio', { name: 'Personalizada' }).check();
  await setup.getByLabel('Mínimo').fill('1');
  await setup.getByLabel('Máximo').fill('5');
  await setup.getByRole('textbox', { name: 'Aprueba con' }).fill('3');
  await setup.getByRole('button', { name: 'Siguiente' }).click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Periodos de evaluación' });
  await expect(cuts.getByRole('radio', { name: '25 % / 25 % / 25 % / 25 %' })).toBeChecked();
  await cuts.getByRole('button', { name: 'Guardar' }).click();
  await expect(cuts).toBeHidden();

  await expect(
    page.getByRole('heading', { level: 2, name: 'Periodo de evaluación 1' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Periodo de evaluación 4' }),
  ).toBeVisible();
  await expect(page.getByText('25 % de la nota final')).toHaveCount(4);
  await expect(page.getByText('Aprobatoria: 3.0')).toBeVisible();
  check();
});

test('C · diplomado: etapas, 1–7, a single "Nota final" and no guessed conversion of points', async ({
  page,
}) => {
  const check = watch(page, ['400 /api/evaluations*']);
  const { subjects } = await account(page, 'OTHER_ACADEMIC', ['Módulo 1']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await expect(page.getByText('La escala y las etapas se comparten')).toBeVisible();

  await page.getByRole('button', { name: 'Configurar notas' }).click();
  const setup = page.getByRole('dialog', { name: 'Configurar notas · Escala' });
  await setup.getByRole('radio', { name: 'Personalizada' }).check();
  await setup.getByLabel('Mínimo').fill('1');
  await setup.getByLabel('Máximo').fill('7');
  await setup.getByRole('textbox', { name: 'Aprueba con' }).fill('4');
  await setup.getByRole('button', { name: 'Siguiente' }).click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Etapas' });
  await expect(cuts.getByRole('radio', { name: 'Sin cortes (una sola nota final)' })).toBeChecked();
  await cuts.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Nota final' })).toBeVisible();
  await expect(page.getByText('100 % de la nota final')).toBeVisible();

  // A direct note on the scale of the period.
  await save(
    await addEvaluation(page, 'Nota final', { name: 'Examen', weight: '50', note: '5.5' }),
  );
  await expect(page.getByTestId('current-grade')).toHaveText('5.5');
  // Points on a scale that does not start at 0: the screen asks for the score as well (it never guesses).
  const dialog = await addEvaluation(page, 'Nota final', {
    name: 'Taller',
    weight: '50',
    points: ['18', '20'],
  });
  await expect(dialog.getByText('En esta escala no se convierte sola')).toBeVisible();
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(
    dialog.getByText('En esta escala escribe también la nota ya convertida.'),
  ).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Nota en la escala del periodo' }).fill('6.5');
  await save(dialog);
  await expect(page.getByText('18 / 20')).toBeVisible();
  await expect(page.getByLabel('Nota: 6.5')).toBeVisible();
  await expect(page.getByTestId('current-grade')).toHaveText('6.0');
  check();
});

test('D · the scale and the cuts are the period’s: a second subject does not configure again', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Farmacología', 'Anatomía']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Escala' })
    .getByRole('button', { name: 'Siguiente' })
    .click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Cortes' })
    .getByRole('button', { name: 'Guardar' })
    .click();
  await expect(page.getByText('Notas configuradas.')).toBeVisible();

  // The entry from the subjects list: "Notas" on the card, without replacing the other actions.
  await page.goto('/subjects');
  await expect(page.getByRole('button', { name: 'Editar Anatomía' })).toBeVisible();
  await page.getByRole('link', { name: 'Notas de Anatomía' }).click();
  await expect(page).toHaveURL(new RegExp(`/subjects/${subjects[1]!.id}/grades$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Notas de Anatomía' })).toBeVisible();
  await expect(page.getByText('Configura cómo califican esta materia')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Corte 3' })).toBeVisible();
  await expect(page.getByText('Aprobatoria: 3.0')).toBeVisible();
  check();
});

test('E · 18 of 20 on a 0–5 scale becomes 4.5, and the points stay next to it', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY');
  await page.goto(gradesUrl(subjects[0]!.id));
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Escala' })
    .getByRole('button', { name: 'Siguiente' })
    .click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Cortes' })
    .getByRole('button', { name: 'Guardar' })
    .click();
  await expect(page.getByText('Notas configuradas.')).toBeVisible();

  const dialog = await addEvaluation(page, 'Corte 1', {
    name: 'Quiz',
    weight: '100',
    points: ['18', '20'],
  });
  await expect(dialog.getByText('La nota se calcula a partir de los puntos')).toBeVisible();
  await save(dialog);
  await expect(page.getByLabel('Nota: 4.5')).toBeVisible();
  await expect(page.getByText('18 / 20')).toBeVisible();
  await expect(page.getByTestId('current-grade')).toHaveText('4.5');

  // Changing only the points recomputes the score (never keeps the old one).
  await page.getByRole('button', { name: 'Más acciones: Quiz' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar evaluación' });
  await edit.getByLabel('Obtenidos').fill('10');
  await save(edit, 'Guardar cambios');
  await expect(page.getByLabel('Nota: 2.5')).toBeVisible();
  await expect(page.getByText('10 / 20')).toBeVisible();
  check();
});

test('F · 320 and 360 px: long names wrap and nothing scrolls sideways', async ({ page }) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', [
    'Introducción a la Ingeniería de Software Orientada a Servicios y Arquitecturas Distribuidas',
  ]);
  await page.goto(gradesUrl(subjects[0]!.id));
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Escala' })
    .getByRole('button', { name: 'Siguiente' })
    .click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Cortes' })
    .getByRole('button', { name: 'Guardar' })
    .click();
  await expect(page.getByText('Notas configuradas.')).toBeVisible();
  const long = 'Evaluación integradora con un nombre larguísimo que debe partirse';
  await save(await addEvaluation(page, 'Corte 1', { name: long, weight: '50', note: '4.2' }));
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 740 });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByText(long)).toBeVisible();
  }
  // The subjects list keeps its three actions on the card without overflowing.
  await page.goto('/subjects');
  await expectNoHorizontalOverflow(page);
  check();
});

test('G · a subject that is not yours looks like one that does not exist, with no onboarding', async ({
  page,
}) => {
  await account(page, 'UNIVERSITY'); // (a 404 is logged by the browser as a console error, so this one does not use watch)
  await page.goto(gradesUrl('00000000-0000-4000-8000-000000000999'));
  await expect(page.getByText('No encontramos esa asignatura.')).toBeVisible();
  await expect(page).not.toHaveURL(/onboarding/);
  await page.getByRole('link', { name: 'Ir a Mis asignaturas' }).click();
  await expect(page).toHaveURL(/\/subjects$/);
});

test('H · an archived study keeps its grades readable', async ({ page }) => {
  const check = watch(page);
  const { subjects, study } = await account(page, 'UNIVERSITY');
  await page.goto(gradesUrl(subjects[0]!.id));
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Escala' })
    .getByRole('button', { name: 'Siguiente' })
    .click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Cortes' })
    .getByRole('button', { name: 'Guardar' })
    .click();
  await save(await addEvaluation(page, 'Corte 1', { name: 'Parcial', weight: '100', note: '4' }));
  await post(page, `/api/study-tracks/${study.id}/archive`);
  await page.goto(gradesUrl(subjects[0]!.id));
  await expect(page.getByText('Este estudio está archivado')).toBeVisible();
  await expect(page.getByTestId('current-grade')).toHaveText('4.0');
  check();
});

test('I · the study type comes with the grades: slow studies/periods lists never show university words', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'SCHOOL', ['Matemáticas']);
  const slow = async (route: import('@playwright/test').Route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  };
  await page.route('**/api/study-tracks', slow);
  await page.route('**/api/periods', slow);
  await page.goto(gradesUrl(subjects[0]!.id));
  // Well before the lists answer, the school wording is already there (it is derived by the server with the grades).
  await expect(page.getByText('La escala y los periodos de evaluación se comparten')).toBeVisible({
    timeout: 3000,
  });
  await expect(page.getByText(/cortes/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  const setup = page.getByRole('dialog', { name: 'Configurar notas · Escala' });
  await setup.getByRole('button', { name: 'Siguiente' }).click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Periodos de evaluación' });
  await expect(cuts.getByRole('radio', { name: '25 % / 25 % / 25 % / 25 %' })).toBeChecked();
  await expect(cuts.getByRole('radio', { name: '30 % / 30 % / 40 %' })).toHaveCount(0);
  check();
});
