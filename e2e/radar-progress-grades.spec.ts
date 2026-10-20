import { expect, test, type Page } from '@playwright/test';
import { bogotaToday, expectNoHorizontalOverflow, register, uniqueEmail, watch } from './helpers';

/**
 * Grade context in the Radar and the Progress. The Radar stays TEMPORAL (the weight is information, never order); the Progress
 * shows the academic grade apart from the activities, and a subject without grade configuration shows no 0.0.
 */
test.setTimeout(120_000);

const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };
const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};

async function world(page: Page) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const st = (await post(page, '/api/study-tracks', { name: 'Ingeniería', type: 'UNIVERSITY' }))
    .studyTrack;
  const period = (
    await post(page, '/api/periods', {
      name: '2026-2',
      startDate: bogotaToday(-30),
      endDate: bogotaToday(90),
      studyTrackId: st.id,
    })
  ).period;
  const mk = async (name: string) =>
    (await post(page, '/api/subjects', { periodId: period.id, name })).subject;
  const cyber = await mk('Ciberseguridad');
  const plain = await mk('Cálculo II');
  const setup = await post(page, `/api/subjects/${cyber.id}/grading/setup`, {
    profile: SCALE,
    gradingPeriods: [3000, 3000, 4000].map((finalShareBp, i) => ({
      name: `Corte ${i + 1}`,
      finalShareBp,
    })),
  });
  return { cyber, plain, cuts: setup.gradingPeriods as { id: string }[] };
}

const activity = async (page: Page, subjectId: string, title: string, plusDays: number) =>
  (
    await post(page, '/api/activities', {
      subjectId,
      title,
      type: 'EXAM',
      dueDate: bogotaToday(plusDays),
    })
  ).activity;

test('Radar shows the weight and the score of a linked activity, and keeps ordering by time', async ({
  page,
}) => {
  const check = watch(page);
  const { cyber, plain, cuts } = await world(page);
  const parcial = await activity(page, cyber.id, 'Parcial de Ciberseguridad', 2);
  const ev = (
    await post(page, '/api/evaluations', {
      subjectId: cyber.id,
      gradingPeriodId: cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 4000,
      activityId: parcial.id,
    })
  ).evaluation;
  const res = await page.request.patch(`/api/evaluations/${ev.id}`, { data: { scoreMilli: 4200 } });
  expect(res.status()).toBe(200);
  await activity(page, plain.id, 'Lectura de Cálculo', 3);
  // heavier (100 % of Corte 3 = 40 % of the final grade) but LATER in time
  const heavy = await activity(page, cyber.id, 'Entrega final pesada', 6);
  await post(page, '/api/evaluations', {
    subjectId: cyber.id,
    gradingPeriodId: cuts[2]!.id,
    name: 'Entrega final',
    periodShareBp: 10_000,
    activityId: heavy.id,
  });

  await page.goto('/radar');
  const row = (t: string) => page.getByRole('listitem').filter({ hasText: t });
  await expect(row('Parcial de Ciberseguridad')).toContainText(
    'Parcial · Corte 1 · 12 % · Nota 4.2',
  );
  await expect(row('Entrega final pesada')).toContainText(
    'Entrega final · Corte 3 · 40 % de la nota final',
  );
  // an activity without evaluation: no placeholder, no grade line
  await expect(row('Lectura de Cálculo')).not.toContainText(/nota/i);
  // time decides the order, not the weight
  const y = async (t: string) => (await row(t).first().boundingBox())!.y;
  expect(await y('Parcial de Ciberseguridad')).toBeLessThan(await y('Lectura de Cálculo'));
  expect(await y('Lectura de Cálculo')).toBeLessThan(await y('Entrega final pesada'));
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  check();
});

test('Progress shows the grade apart from the activities; a subject without configuration shows no 0.0', async ({
  page,
}) => {
  const check = watch(page);
  const { cyber, cuts } = await world(page);
  const parcial = await activity(page, cyber.id, 'Parcial', 2);
  const ev = (
    await post(page, '/api/evaluations', {
      subjectId: cyber.id,
      gradingPeriodId: cuts[0]!.id,
      name: 'Parcial',
      periodShareBp: 4000,
      activityId: parcial.id,
    })
  ).evaluation;
  await page.request.patch(`/api/evaluations/${ev.id}`, { data: { scoreMilli: 4200 } });

  await page.goto('/progress');
  const grades = page.getByRole('region', { name: 'Notas' });
  await expect(grades).toBeVisible();
  await expect(grades).toContainText('Ciberseguridad');
  await expect(grades).toContainText('Acumulada 0.5 / 5.0');
  await expect(grades).toContainText('0 de 3 cortes con nota');
  await expect(grades).toContainText('Estimación: faltan pesos por definir.');
  await expect(grades).not.toContainText('Cálculo II');
  await expect(grades).not.toContainText('0.0');
  // the activities progress keeps its own block, with its own figures
  await expect(
    page.getByRole('progressbar', { name: 'Progreso general de actividades' }),
  ).toBeVisible();

  // two more cuts with a direct grade: 0.504 + 1.35 + 1.6 accumulated, and 2 of 3 cuts have a grade
  await post(page, '/api/evaluations', {
    subjectId: cyber.id,
    gradingPeriodId: cuts[1]!.id,
    isCutGrade: true,
    scoreMilli: 4500,
  });
  await post(page, '/api/evaluations', {
    subjectId: cyber.id,
    gradingPeriodId: cuts[2]!.id,
    isCutGrade: true,
    scoreMilli: 4000,
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Notas' })).toContainText('Acumulada 3.5 / 5.0');
  await expect(page.getByRole('region', { name: 'Notas' })).toContainText('2 de 3 cortes con nota');
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  check();
});

test('Progress: with no subject configured there is no Notas section at all', async ({ page }) => {
  const check = watch(page);
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const st = (await post(page, '/api/study-tracks', { name: 'Ingeniería', type: 'UNIVERSITY' }))
    .studyTrack;
  const period = (
    await post(page, '/api/periods', {
      name: '2026-2',
      startDate: bogotaToday(-30),
      endDate: bogotaToday(90),
      studyTrackId: st.id,
    })
  ).period;
  await post(page, '/api/subjects', { periodId: period.id, name: 'Redes' });
  await page.goto('/progress');
  await expect(page.getByText('Redes').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notas' })).toHaveCount(0);
  check();
});
