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
  const add = page.getByRole('button', { name: `Agregar evaluación a ${cut}` });
  if (await add.count()) await add.click();
  else {
    await page.getByRole('button', { name: `Más acciones: ${cut}` }).click();
    await page.getByRole('menuitem', { name: 'Desglosar evaluaciones' }).click();
  }
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
  await expect(page.getByText('Configura las notas de esta materia')).toBeVisible();
  await expect(
    page.getByText(/la escala, que se comparte con las demás materias de este periodo/),
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
  await expect(page.getByText(/Objetivo para aprobar: 3[.]0/)).toBeVisible();
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
  await expect(page.getByText(/Lo evaluado hasta ahora/)).toHaveCount(0); // no textual verdict in the summary
  // The accumulated grade of the subject is another figure: 3.9 on 30 % of the final grade = 1.17 → 1.2.
  await expect(page.getByTestId('accumulated-grade')).toHaveText('1.2');
  // Cuts 2 and 3 have no evaluations: their weight is DEFINED (just pending), so this is not an estimate.
  await expect(page.getByTestId('estimate-note')).toHaveCount(0);
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
  // Corte 1 is now described to 60 % only: THAT is an undefined weight, and it names the cut.
  await expect(page.getByTestId('estimate-note')).toContainText(
    'falta definir parte del peso de Corte 1',
  );

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
  await expect(page.getByText('Configura las notas de esta materia')).toBeVisible();

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
  await expect(page.getByText(/Objetivo para aprobar: 3[.]0/)).toBeVisible();
  check();
});

test('C · diplomado: etapas, 1–7, a single "Nota final" and no guessed conversion of points', async ({
  page,
}) => {
  const check = watch(page, ['400 /api/evaluations*']);
  const { subjects } = await account(page, 'OTHER_ACADEMIC', ['Módulo 1']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await expect(page.getByText('Configura las notas de esta materia')).toBeVisible();

  await page.getByRole('button', { name: 'Configurar notas' }).click();
  const setup = page.getByRole('dialog', { name: 'Configurar notas · Escala' });
  await setup.getByRole('radio', { name: 'Personalizada' }).check();
  await setup.getByLabel('Mínimo').fill('1');
  await setup.getByLabel('Máximo').fill('7');
  await setup.getByRole('textbox', { name: 'Aprueba con' }).fill('4');
  await setup.getByRole('button', { name: 'Siguiente' }).click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Etapas' });
  await expect(cuts.getByRole('radio', { name: 'Una sola nota (100 %)' })).toBeChecked();
  await cuts.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Nota final' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Nota final' }).getByText('100 % de la nota final'),
  ).toBeVisible();

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

test('D · the scale is the period’s, the cuts are each subject’s: a second subject is asked how IT is split', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Farmacología', 'Anatomía']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await configureDefault(page); // scale + 30/30/40 for Farmacología

  // The entry from the subjects list: "Notas" on the card, without replacing the other actions.
  await page.goto('/subjects');
  await expect(page.getByRole('button', { name: 'Editar Anatomía' })).toBeVisible();
  await page.getByRole('link', { name: 'Notas de Anatomía' }).click();
  await expect(page).toHaveURL(new RegExp(`/subjects/${subjects[1]!.id}/grades$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Notas de Anatomía' })).toBeVisible();
  // The scale exists, the 30/30/40 of Farmacología is NOT inherited: it asks how THIS subject is split.
  await expect(page.getByText('¿Cómo se divide esta materia?')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Corte 3' })).toHaveCount(0);
  await configureCuts(page, { custom: ['50', '50'] });
  await expect(page.getByRole('heading', { level: 2, name: 'Corte 2' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Corte 3' })).toHaveCount(0);
  await expect(page.getByText('50 % de la nota final')).toHaveCount(2);

  // Farmacología keeps its own 30/30/40.
  await page.goto(gradesUrl(subjects[0]!.id));
  await expect(page.getByText('30 % de la nota final')).toHaveCount(2);
  await expect(page.getByText('40 % de la nota final')).toBeVisible();
  await expect(page.getByText('50 % de la nota final')).toHaveCount(0);
  check();
});

test('L · same period, three distributions: each subject calculates with ITS OWN cuts', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', [
    'Farmacología',
    'Bases de datos',
    'Seminario',
  ]);
  const [farma, bases, seminario] = subjects;

  // Farmacología: 30/30/40 (and the scale of the period)
  await page.goto(gradesUrl(farma!.id));
  await configureDefault(page);
  for (const [cut, grade] of [
    ['Corte 1', '3.2'],
    ['Corte 2', '4.5'],
    ['Corte 3', '4.0'],
  ] as const)
    await registerCutGrade(page, cut, grade);
  await expect(page.getByTestId('accumulated-grade')).toHaveText('3.9'); // 3.91

  // Bases de datos: 25 / (blank) / 40 → the blank takes the rest, 35
  await page.goto(gradesUrl(bases!.id));
  await expect(page.getByText('¿Cómo se divide esta materia?')).toBeVisible();
  await configureCuts(page, { custom: ['25', '', '40'] });
  await expect(page.getByText('25 % de la nota final')).toBeVisible();
  await expect(page.getByText('35 % de la nota final')).toBeVisible();
  await expect(page.getByText('40 % de la nota final')).toBeVisible();
  for (const [cut, grade] of [
    ['Corte 1', '3.2'],
    ['Corte 2', '4.5'],
    ['Corte 3', '4.0'],
  ] as const)
    await registerCutGrade(page, cut, grade);
  await expect(page.getByTestId('accumulated-grade')).toHaveText('4.0'); // 3.975 shown with one decimal

  // Seminario: a single grade of 100 %
  await page.goto(gradesUrl(seminario!.id));
  await configureCuts(page, { radio: 'Una sola nota (100 %)' });
  await expect(page.getByRole('heading', { level: 2, name: 'Nota final' })).toBeVisible();
  await registerCutGrade(page, 'Nota final', '4.3');
  await expect(page.getByTestId('accumulated-grade')).toHaveText('4.3');
  await expect(page.getByTestId('weights-line')).toContainText('Calificado 100 %');
  await expect(page.getByTestId('weights-line')).toContainText('Pendiente 0 %');
  await expect(page.getByText('¿Cuánto necesito?')).toHaveCount(0);

  // No leakage: Farmacología and Bases de datos still say what they said.
  await page.goto(gradesUrl(farma!.id));
  await expect(page.getByTestId('accumulated-grade')).toHaveText('3.9');
  await expect(page.getByText('30 % de la nota final')).toHaveCount(2);
  await page.goto(gradesUrl(bases!.id));
  await expect(page.getByTestId('accumulated-grade')).toHaveText('4.0');
  await expect(page.getByText('35 % de la nota final')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  check();
});

test('M · a single grade of 100 %: "Nota final", register 4.6 → 4.6 / 5.0, fully graded', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Proyecto integrador']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  await page
    .getByRole('dialog', { name: 'Configurar notas · Escala' })
    .getByRole('button', { name: 'Siguiente' })
    .click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Cortes' });
  await cuts.getByRole('radio', { name: 'Una sola nota (100 %)' }).check();
  await cuts.getByRole('button', { name: 'Guardar' }).click();
  await expect(cuts).toBeHidden();
  const card = page.getByRole('region', { name: 'Nota final' });
  await expect(card.getByText('100 % de la nota final')).toBeVisible();
  await expect(card.getByTestId(/^cut-grade-/)).toHaveText('Pendiente');
  await registerCutGrade(page, 'Nota final', '4.6');
  await expect(page.getByTestId('accumulated-grade')).toHaveText('4.6');
  await expect(page.getByText('/ 5.0')).toBeVisible();
  await expect(page.getByTestId('weights-line')).toContainText('Calificado 100 %');
  check();
});

test('E · 18 of 20 on a 0–5 scale becomes 4.5 as the grade of a cut, with no name asked', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY');
  await page.goto(gradesUrl(subjects[0]!.id));
  await configureDefault(page);

  await page.getByRole('button', { name: 'Registrar nota de Corte 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nota de Corte 1' });
  await expect(dialog.getByLabel('Nombre')).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Puntos' }).check();
  await dialog.getByLabel('Obtenidos').fill('18');
  await dialog.getByLabel('De', { exact: true }).fill('20');
  await expect(dialog.getByText('La nota se calcula a partir de los puntos')).toBeVisible();
  await save(dialog, 'Guardar');
  await expect(page.getByTestId(/^cut-grade-/).first()).toHaveText('4.5');
  await expect(page.getByTestId('current-grade')).toHaveText('4.5');

  // Changing only the points recomputes the grade (never keeps the old one).
  await page.getByRole('button', { name: 'Editar nota de Corte 1' }).click();
  const edit = page.getByRole('dialog', { name: 'Nota de Corte 1' });
  await edit.getByLabel('Obtenidos').fill('10');
  await save(edit, 'Guardar');
  await expect(page.getByTestId(/^cut-grade-/).first()).toHaveText('2.5');
  check();
});

/** Registers the grade of a whole cut (the dialog never asks for a name). */
async function registerCutGrade(page: Page, cut: string, grade: string) {
  await page.getByRole('button', { name: `Registrar nota de ${cut}` }).click();
  const dialog = page.getByRole('dialog', { name: `Nota de ${cut}` });
  await dialog.getByRole('textbox', { name: 'Nota' }).fill(grade);
  await save(dialog, 'Guardar');
}

/** How ONE subject is split, once the period already has its scale: a quick option or custom percentages (blank = the rest). */
async function configureCuts(page: Page, how: { radio: string } | { custom: string[] }) {
  await page
    .getByRole('button', { name: /^Configurar (cortes|periodos de evaluación|etapas)$/ })
    .click();
  const dialog = page.getByRole('dialog', { name: /^Configurar notas · / });
  if ('radio' in how) await dialog.getByRole('radio', { name: how.radio }).check();
  else {
    await dialog.getByRole('radio', { name: 'Personalizar' }).check();
    // start from the three rows of the first option; drop the extra ones, then type each percentage ("" = leave blank)
    for (let i = 2; i >= how.custom.length; i--)
      await dialog.getByRole('button', { name: `Quitar Corte ${i + 1}` }).click();
    for (const [i, percent] of how.custom.entries())
      await dialog.locator(`#cut-percent-${i}`).fill(percent);
  }
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog).toBeHidden();
}

/** The default configuration: 0.0–5.0 with 30/30/40. */
async function configureDefault(page: Page) {
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
}

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
  // Well before the lists answer the page is usable and says nothing in university words (the study comes with the grades).
  await expect(page.getByText('Configura las notas de esta materia')).toBeVisible({
    timeout: 3000,
  });
  await expect(page.getByText(/cortes/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Configurar notas' }).click();
  const setup = page.getByRole('dialog', { name: 'Configurar notas · Escala' });
  await setup.getByRole('button', { name: 'Siguiente' }).click();
  const cuts = page.getByRole('dialog', { name: 'Configurar notas · Periodos de evaluación' });
  await expect(page.getByText(/cortes/i)).toHaveCount(0);
  await expect(cuts.getByRole('radio', { name: '25 % / 25 % / 25 % / 25 %' })).toBeChecked();
  await expect(cuts.getByRole('radio', { name: '30 % / 30 % / 40 %' })).toHaveCount(0);
  check();
});

test('J · materia → corte → nota: only the second cut graded 4.5, no name asked, nothing to estimate', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Farmacología']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await configureDefault(page);

  // Every cut starts as "Pendiente" with one button: no evaluation form to begin with.
  await expect(page.getByText('Aún no hay evaluaciones')).toHaveCount(0);
  await expect(page.getByTestId('accumulated-grade')).toHaveText('Sin notas todavía');

  await page.getByRole('button', { name: 'Registrar nota de Corte 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nota de Corte 2' });
  await expect(dialog.getByLabel('Nombre')).toHaveCount(0); // the cut and the subject already say what it is
  await expect(dialog.getByLabel(/^Peso/)).toHaveCount(0);
  await axe(page, 'grades · cut grade dialog');
  await dialog.getByRole('textbox', { name: 'Nota' }).fill('4.5');
  await save(dialog, 'Guardar');

  const card = page.getByRole('region', { name: 'Corte 2' });
  await expect(card.getByTestId(/^cut-grade-/)).toHaveText('4.5');
  await expect(card.getByText('Aporta a la definitiva: 1.35')).toBeVisible();
  await expect(page.getByTestId('accumulated-grade')).toHaveText('1.4');
  await expect(page.getByTestId('current-grade')).toHaveText('4.5');
  await expect(page.getByTestId('cuts-with-grade')).toHaveText('1 de 3 cortes con nota');
  await expect(page.getByTestId('weights-line')).toContainText('Calificado 30 %');
  await expect(page.getByTestId('weights-line')).toContainText('Pendiente 70 %');
  await expect(page.getByTestId('required-text')).toHaveText(
    'Necesitas aproximadamente 2.4 de promedio en el 70 % restante para llegar a 3.0.',
  );
  await expect(page.getByTestId('remaining-line')).toHaveText('Queda 70 % de la nota final.');
  await expect(page.getByTestId('estimate-note')).toHaveCount(0);
  await expect(page.getByText(/faltan pesos por definir/)).toHaveCount(0);

  // Breaking a cut that has a grade down asks first (the direct grade goes away); the breakdown is the secondary path.
  await page.getByRole('button', { name: 'Más acciones: Corte 2' }).click();
  await page.getByRole('menuitem', { name: 'Desglosar evaluaciones' }).click();
  const ask = page.getByRole('dialog', { name: 'Desglosar Corte 2' });
  await expect(ask.getByText('Este corte tiene una nota directa.')).toBeVisible();
  await ask.getByRole('button', { name: 'Cancelar' }).click();
  await expect(card.getByTestId(/^cut-grade-/)).toHaveText('4.5');

  await expectNoHorizontalOverflow(page);
  await axe(page, 'grades · direct cut grades');
  check();
});

test('K · the three cuts graded 3.2 / 4.5 / 4.0 is 3.9, fully graded, with nothing to ask', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Farmacología']);
  await page.goto(gradesUrl(subjects[0]!.id));
  await configureDefault(page);
  for (const [cut, grade] of [
    ['Corte 1', '3.2'],
    ['Corte 2', '4.5'],
    ['Corte 3', '4.0'],
  ] as const) {
    await page.getByRole('button', { name: `Registrar nota de ${cut}` }).click();
    const dialog = page.getByRole('dialog', { name: `Nota de ${cut}` });
    await expect(dialog.getByLabel('Nombre')).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Nota' }).fill(grade);
    await save(dialog, 'Guardar');
  }
  await expect(page.getByTestId('accumulated-grade')).toHaveText('3.9');
  await expect(page.getByTestId('cuts-with-grade')).toHaveText('3 de 3 cortes con nota');
  await expect(page.getByTestId('weights-line')).toContainText('Calificado 100 %');
  await expect(page.getByTestId('weights-line')).toContainText('Pendiente 0 %');
  await expect(page.getByText('Aporta a la definitiva: 0.96')).toBeVisible();
  await expect(page.getByText('Aporta a la definitiva: 1.35')).toBeVisible();
  await expect(page.getByText('Aporta a la definitiva: 1.60')).toBeVisible();
  await expect(page.getByText('¿Cuánto necesito?')).toHaveCount(0);
  await expect(page.getByTestId('estimate-note')).toHaveCount(0);
  await expect(page.getByText(/Peso:/)).toHaveCount(0);
  check();
});

test('M · Editar distribución: 30/30/40 → 40/30/30 with the last cut automatic, visible before saving, other subject untouched', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Ciberseguridad', 'Redes']);
  const [ciber, redes] = subjects;
  const split = async (id: string, shares: number[], withScale: boolean) =>
    post(page, `/api/subjects/${id}/grading/setup`, {
      ...(withScale && { profile: { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 } }),
      gradingPeriods: shares.map((finalShareBp, i) => ({ name: `Corte ${i + 1}`, finalShareBp })),
    });
  await split(ciber!.id, [3000, 3000, 4000], true);
  await split(redes!.id, [5000, 5000], false);

  await page.goto(gradesUrl(ciber!.id));
  await page.getByRole('button', { name: 'Editar distribución' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar distribución' });
  await expect(dialog.getByLabel('Corte 3 (%)')).toHaveValue('40');
  await expect(
    dialog.getByRole('checkbox', { name: 'Completar automáticamente: Corte 3' }),
  ).toBeChecked();

  await dialog.getByLabel('Corte 1 (%)').fill('40');
  // Everything is visible BEFORE saving
  await expect(dialog.getByLabel('Corte 1 (%)')).toHaveValue('40');
  await expect(dialog.getByLabel('Corte 2 (%)')).toHaveValue('30');
  await expect(dialog.getByLabel('Corte 3 (%)')).toHaveValue('30');
  await expect(dialog.getByText('✓ Distribución completa')).toBeVisible();
  await expect(dialog.getByText('Total: 100 %')).toBeVisible();

  // Over 100 %: warned, cannot save, the automatic cut is never negative
  await dialog.getByLabel('Corte 1 (%)').fill('80');
  await dialog.getByLabel('Corte 2 (%)').fill('50');
  await expect(dialog.getByText('Te pasaste por 30 %.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await axe(page, 'grades · distribution dialog');

  await dialog.getByLabel('Corte 1 (%)').fill('40');
  await dialog.getByLabel('Corte 2 (%)').fill('30');
  await expect(dialog.getByLabel('Corte 3 (%)')).toHaveValue('30');
  await save(dialog, 'Guardar');
  await expect(page.getByText('Distribución guardada.')).toBeVisible();

  await page.reload();
  const shares = async (id: string) =>
    (await (await page.request.get(`/api/subjects/${id}/grades`)).json()).gradingPeriods.map(
      (c: { finalShareBp: number }) => c.finalShareBp,
    );
  expect(await shares(ciber!.id)).toEqual([4000, 3000, 3000]);
  expect(await shares(redes!.id)).toEqual([5000, 5000]);
  await expectNoHorizontalOverflow(page);
  check();
});

test('N · Editar corte only renames: the weight lives in Editar distribución and the 100 % holds', async ({
  page,
}) => {
  const check = watch(page);
  const { subjects } = await account(page, 'UNIVERSITY', ['Ciberseguridad']);
  await post(page, `/api/subjects/${subjects[0]!.id}/grading/setup`, {
    profile: { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 },
    gradingPeriods: [
      { name: 'Corte 1', finalShareBp: 3000 },
      { name: 'Corte 2', finalShareBp: 3000 },
      { name: 'Corte 3', finalShareBp: 4000 },
    ],
  });
  const shares = async () =>
    (
      await (await page.request.get(`/api/subjects/${subjects[0]!.id}/grades`)).json()
    ).gradingPeriods.map((c: { name: string; finalShareBp: number }) => [c.name, c.finalShareBp]);
  await page.goto(gradesUrl(subjects[0]!.id));

  await page.getByRole('button', { name: 'Más acciones: Corte 1' }).click();
  await page.getByRole('menuitem', { name: 'Editar corte' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar corte' });
  await expect(dialog.getByLabel('Peso en la nota final (%)')).toHaveCount(0);
  await expect(
    dialog.getByText('Para cambiar porcentajes usa «Editar distribución».'),
  ).toBeVisible();
  // one of several cuts cannot be deleted (it would leave the total below 100 %), and there is no "add a cut" either
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Más acciones: Corte 1' }).click();
  await expect(page.getByRole('menuitem', { name: /^Eliminar/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Más acciones: Corte 1' }).click();
  await page.getByRole('menuitem', { name: 'Editar corte' }).click();
  const again = page.getByRole('dialog', { name: 'Editar corte' });
  await again.getByLabel('Nombre').fill('Primer corte');
  await save(again, 'Guardar');
  await expect(page.getByRole('region', { name: 'Primer corte' })).toBeVisible();
  expect(await shares()).toEqual([
    ['Primer corte', 3000],
    ['Corte 2', 3000],
    ['Corte 3', 4000],
  ]);

  await page.getByRole('button', { name: 'Editar distribución' }).click();
  const dist = page.getByRole('dialog', { name: 'Editar distribución' });
  await dist.getByLabel('Primer corte (%)').fill('40');
  await expect(dist.getByLabel('Corte 3 (%)')).toHaveValue('30');
  await save(dist, 'Guardar');
  await expect(page.getByText('Distribución guardada.')).toBeVisible();
  expect(await shares()).toEqual([
    ['Primer corte', 4000],
    ['Corte 2', 3000],
    ['Corte 3', 3000],
  ]);
  check();
});
