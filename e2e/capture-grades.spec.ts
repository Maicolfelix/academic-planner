import { expect, test, type Page } from '@playwright/test';
import { bogotaToday, expectNoHorizontalOverflow, register, uniqueEmail, watch } from './helpers';

/**
 * Smart Capture of grades (B3), end to end: one text becomes a cut grade, a score for a pending evaluation, or an activity
 * together with its evaluation — with ONE confirmation, asking only what is in doubt. Accounts are prepared through the API.
 */
test.setTimeout(120_000);

const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };
const SCALE = { minMilli: 0, maxMilli: 5000, passMilli: 3000, decimals: 1 };

const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};

const quick = (page: Page) => page.getByRole('region', { name: 'Captura rápida' });
const cards = (page: Page) => quick(page).getByRole('article');

async function study(
  page: Page,
  name: string,
  subjectNames: string[],
  shares = [3000, 3000, 4000],
  type: 'UNIVERSITY' | 'OTHER_ACADEMIC' = 'UNIVERSITY',
) {
  const st = (await post(page, '/api/study-tracks', { name, type })).studyTrack;
  const period = (
    await post(page, '/api/periods', { name: `P ${name}`, ...dates, studyTrackId: st.id })
  ).period;
  const out: { id: string; name: string; cuts: { id: string; name: string }[] }[] = [];
  for (const subjectName of subjectNames) {
    const subject = (await post(page, '/api/subjects', { periodId: period.id, name: subjectName }))
      .subject;
    const setup = await post(page, `/api/subjects/${subject.id}/grading/setup`, {
      profile: SCALE,
      gradingPeriods: shares.map((finalShareBp, i) => ({
        name: `${type === 'UNIVERSITY' ? 'Corte' : 'Etapa'} ${i + 1}`,
        finalShareBp,
      })),
    });
    out.push({ id: subject.id, name: subjectName, cuts: setup.gradingPeriods });
  }
  return out;
}

async function start(page: Page) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function write(page: Page, text: string) {
  await page.goto('/dashboard');
  await quick(page).getByLabel('Escribe lo que tienes pendiente').fill(text);
  await quick(page).getByRole('button', { name: 'Interpretar', exact: true }).click();
  await expect(quick(page).locator('#capture-review-title')).toBeVisible();
}

const gradesOf = async (page: Page, subjectId: string) =>
  (await (await page.request.get(`/api/subjects/${subjectId}/grades`)).json()).evaluations as {
    id: string;
    name: string;
    scoreMilli: number | null;
    rawEarnedMilli: number | null;
    rawMaxMilli: number | null;
    isCutGrade: boolean;
    periodShareBp: number;
    activityId: string | null;
  }[];

for (const viewport of [
  { width: 360, height: 780 },
  { width: 1366, height: 800 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test('a cut grade is understood, shown in plain words and saved with one confirmation', async ({
      page,
    }) => {
      const check = watch(page);
      await start(page);
      const [farma] = await study(page, 'Medicina', ['Farmacología']);
      await write(page, 'Saqué 4.3 en el Corte 2 de Farmacología');
      await expect(cards(page)).toHaveCount(1);
      await expect(cards(page).first()).toContainText('Farmacología');
      await expect(cards(page).first()).toContainText('Corte 2');
      await expect(cards(page).first()).toContainText('Nota: 4.3');
      await expect(cards(page).first()).not.toContainText(/scoreMilli|isCutGrade|periodShareBp/);
      await expectNoHorizontalOverflow(page);
      await quick(page).getByRole('button', { name: 'Guardar 1 nota' }).click();
      await expect(quick(page).getByText('1 nota guardada')).toBeVisible();
      const ev = await gradesOf(page, farma!.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ isCutGrade: true, scoreMilli: 4300 });
      check();
    });

    test('an activity and its evaluation are created together', async ({ page }) => {
      const check = watch(page);
      await start(page);
      const [anat] = await study(page, 'Medicina', ['Anatomía'], [5000, 5000]);
      await write(page, 'Parcial de Anatomía el viernes, vale 40% del Corte 1');
      await expect(cards(page)).toHaveCount(2);
      await expect(quick(page).getByText('Corte 1 · 40 %')).toBeVisible();
      await quick(page).getByRole('button', { name: 'Crear 1 actividad y 1 nota' }).click();
      await expect(quick(page).getByText(/1 actividad creada/)).toBeVisible();
      const ev = await gradesOf(page, anat!.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ scoreMilli: null, periodShareBp: 4000 });
      expect(ev[0]!.activityId).not.toBeNull();
      check();
    });

    test('a score goes to the pending evaluation (no duplicate), also in points', async ({
      page,
    }) => {
      const check = watch(page);
      await start(page);
      const [anat] = await study(page, 'Medicina', ['Anatomía'], [5000, 5000]);
      const parcial = (
        await post(page, '/api/evaluations', {
          subjectId: anat!.id,
          gradingPeriodId: anat!.cuts[0]!.id,
          name: 'Parcial',
          periodShareBp: 10_000,
        })
      ).evaluation;
      await write(page, 'Saqué 18 de 20 en el parcial de Anatomía');
      await expect(cards(page).first()).toContainText('Nota: 4.5 (18 / 20)');
      await quick(page).getByRole('button', { name: 'Guardar 1 nota' }).click();
      await expect(quick(page).getByText('1 nota guardada')).toBeVisible();
      const ev = await gradesOf(page, anat!.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        id: parcial.id,
        scoreMilli: 4500,
        rawEarnedMilli: 18_000,
        rawMaxMilli: 20_000,
      });
      check();
    });

    test('weight and score in one sentence: activity + evaluation created already scored', async ({
      page,
    }) => {
      const check = watch(page);
      await start(page);
      const [anat] = await study(page, 'Medicina', ['Anatomía'], [5000, 5000]);
      await write(page, 'Parcial de Anatomía el viernes, vale 40% del Corte 1 y saqué 4.2');
      await expect(cards(page)).toHaveCount(2);
      await expect(quick(page).getByText('Nota: 4.2')).toBeVisible();
      await expect(quick(page).getByText('Nota: Pendiente')).toHaveCount(0);
      await quick(page).getByRole('button', { name: 'Crear 1 actividad y 1 nota' }).click();
      await expect(quick(page).getByText(/1 actividad creada/)).toBeVisible();
      const ev = await gradesOf(page, anat!.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ scoreMilli: 4200, periodShareBp: 4000 });
      expect(ev[0]!.activityId).not.toBeNull();
      const activities = (await (await page.request.get('/api/activities')).json()).activities;
      expect(activities).toHaveLength(1);
      check();
    });

    test('a subject of a secondary study never creates an activity in HOME', async ({ page }) => {
      const check = watch(page);
      await start(page);
      await study(page, 'Medicina', ['Anatomía'], [5000, 5000]);
      const [ingles] = await study(page, 'Diplomado', ['Inglés'], [5000, 5000], 'OTHER_ACADEMIC');
      await write(page, 'Parcial de Inglés el viernes, vale 40% de la Etapa 1');
      await expect(cards(page)).toHaveCount(1); // only the evaluation
      await expect(quick(page).getByText(/no se añadirá a la agenda/)).toBeVisible();
      await quick(page)
        .getByRole('button', { name: 'Crear 1 nota' })
        .or(quick(page).getByRole('button', { name: 'Guardar 1 nota' }))
        .click();
      await expect(quick(page).getByText(/1 evaluación agregada/)).toBeVisible();
      expect(await gradesOf(page, ingles!.id)).toHaveLength(1);
      expect((await (await page.request.get('/api/activities')).json()).activities).toHaveLength(0);
      const subjects = (await (await page.request.get('/api/subjects')).json()).subjects as {
        name: string;
      }[];
      expect(subjects.filter((x) => x.name === 'Inglés')).toHaveLength(1);
      check();
    });

    test('an ambiguous subject is asked, then the grade is saved', async ({ page }) => {
      const check = watch(page);
      await start(page);
      const [farma, anat] = await study(page, 'Medicina', ['Farmacología', 'Anatomía']);
      await write(page, 'Saqué 4.5 en Corte 2');
      await expect(quick(page).getByText('¿A cuál asignatura te refieres?')).toBeVisible();
      await expect(quick(page).getByRole('button', { name: /^Crear 0/ })).toBeDisabled();
      await quick(page)
        .getByRole('button', { name: /^Farmacología/ })
        .click();
      await quick(page).getByRole('button', { name: 'Guardar 1 nota' }).click();
      await expect(quick(page).getByText('1 nota guardada')).toBeVisible();
      expect(await gradesOf(page, farma!.id)).toHaveLength(1);
      expect(await gradesOf(page, anat!.id)).toHaveLength(0);
      check();
    });

    test('the same subject name in two studies is never picked for the student', async ({
      page,
    }) => {
      const check = watch(page);
      await start(page);
      const [medicina] = await study(page, 'Medicina', ['Farmacología']);
      const [enfermeria] = await study(page, 'Enfermería', ['Farmacología']);
      await write(page, 'Saqué 4.3 en el Corte 2 de Farmacología');
      await expect(quick(page).getByText('¿A cuál asignatura te refieres?')).toBeVisible();
      await expect(
        quick(page).getByRole('button', { name: 'Farmacología · Medicina' }),
      ).toBeVisible();
      await quick(page).getByRole('button', { name: 'Farmacología · Enfermería' }).click();
      await quick(page).getByRole('button', { name: 'Guardar 1 nota' }).click();
      await expect(quick(page).getByText('1 nota guardada')).toBeVisible();
      expect(await gradesOf(page, medicina!.id)).toHaveLength(0);
      expect(await gradesOf(page, enfermeria!.id)).toHaveLength(1);
      check();
    });
  });
}
