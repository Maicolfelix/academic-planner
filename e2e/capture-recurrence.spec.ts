import AxeBuilder from '@axe-core/playwright';
import { toLocalParts, weekdayOf } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Smart recurrence, end to end (F1-2e): a text that says what repeats every week ("Tengo Ciberseguridad todos los martes y
 * jueves de 6 pm a 8 pm") becomes ONE «Horario semanal» card in the same review as the activities, asks only what is
 * missing (the end hour is never invented), and one confirmation creates the activities and the weekly blocks together —
 * or nothing. A repeating ACTIVITY ("un quiz todos los viernes") is explained and creates nothing.
 *
 * The browser clock decides what "today" is, so blocks are read back by weekday and hour from the next seven days.
 */

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const quick = (page: Page) => page.getByRole('region', { name: 'Captura rápida' });
const box = (page: Page) => quick(page).getByLabel('Escribe lo que tienes pendiente');
const cards = (page: Page) => quick(page).getByRole('article');
const button = (page: Page, name: string | RegExp) =>
  quick(page).getByRole('button', { name, exact: typeof name === 'string' });

async function newUser(page: Page, subjects: string[] = ['Ciberseguridad']) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  for (const name of subjects) await addSubjectViaUi(page, name);
}

async function write(page: Page, text: string) {
  await page.goto('/dashboard');
  await box(page).fill(text);
  await button(page, 'Interpretar').click();
  await expect(quick(page).locator('#capture-review-title')).toBeVisible();
}

interface Occurrence {
  blockId: string;
  title: string;
  startAt: string;
  endAt: string;
}
/** Every occurrence of the next seven days: each weekday of a weekly block appears once. */
const week = async (page: Page) =>
  (
    await (
      await page.request.get(`/api/schedule?from=${bogotaToday(0)}&to=${bogotaToday(6)}`)
    ).json()
  ).occurrences as Occurrence[];
const lived = (o: Occurrence) => {
  const start = toLocalParts(o.startAt, 'America/Bogota');
  return {
    weekday: weekdayOf(start.date),
    start: start.time,
    end: toLocalParts(o.endAt, 'America/Bogota').time,
  };
};
const activities = async (page: Page) =>
  (await (await page.request.get('/api/activities')).json()).activities as { title: string }[];
const subjectNames = async (page: Page) =>
  ((await (await page.request.get('/api/subjects')).json()).subjects as { name: string }[]).map(
    (s) => s.name,
  );

const CIBER = 'Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm';
const MIXED =
  'Tengo un parcial de redes el viernes a las 8 am y clase de ciberseguridad todos los martes y jueves de 6 pm a 8 pm';

test('A. "todos los martes y jueves de 6 pm a 8 pm": one weekly card, one click, two weekly blocks in the Agenda', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, CIBER);

  await expect(cards(page)).toHaveCount(1);
  const card = cards(page).first();
  await expect(card).toContainText('Horario semanal');
  await expect(card).toContainText('Ciberseguridad');
  await expect(card).toContainText('Todos los martes y jueves · 6:00 p. m. – 8:00 p. m.');
  await expect(card).toContainText('Lista');
  await expect(card.getByRole('checkbox')).toBeChecked();
  await expect(quick(page).getByText('Falta algo')).toHaveCount(0);
  expect(await week(page)).toHaveLength(0); // interpreting creates nothing

  await button(page, 'Crear horario').click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '2 bloques de horario creados.' }),
  ).toBeVisible();

  const blocks = (await week(page)).map(lived).sort((a, b) => a.weekday - b.weekday);
  expect(blocks).toEqual([
    { weekday: 2, start: '18:00', end: '20:00' },
    { weekday: 4, start: '18:00', end: '20:00' },
  ]);
  expect(await activities(page)).toHaveLength(0);

  // The Agenda already shows them: no reload needed.
  await quick(page).getByRole('link', { name: 'Ver agenda' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1366) < 768) {
    // the phone's day list says which days have a block
    await expect(page.getByRole('button', { name: /, 1 bloque$/ })).toHaveCount(2);
  } else {
    await expect(page.getByText('Ciberseguridad').first()).toBeAttached();
  }
  assertClean();
});

test('B. "Veo Redes todos los lunes a las 7 am": only "¿Hasta qué hora?" is asked, once, and the end is never invented', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores']);
  await write(page, 'Veo Redes todos los lunes a las 7 am');

  await expect(cards(page)).toHaveCount(1);
  await expect(quick(page).getByText('¿Hasta qué hora?')).toHaveCount(1);
  await expect(quick(page).getByText('Falta algo')).toBeVisible();
  await expect(cards(page).first().getByRole('checkbox')).not.toBeChecked();
  await expect(button(page, /^(Crear|Resolver antes de guardar)/)).toBeDisabled();
  expect(await week(page)).toHaveLength(0);

  await quick(page).getByLabel('Hora final', { exact: true }).fill('09:00');
  await expect(cards(page).first()).toContainText('Todos los lunes · 7:00 a. m. – 9:00 a. m.');
  await expect(cards(page).first().getByRole('checkbox')).toBeChecked();
  await expect(quick(page).getByText('¿Hasta qué hora?')).toHaveCount(0);

  await button(page, 'Crear horario').click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '1 bloque de horario creado.' }),
  ).toBeVisible();
  expect((await week(page)).map(lived)).toEqual([{ weekday: 1, start: '07:00', end: '09:00' }]);
  assertClean();
});

test('C. an exam and a weekly class in one text: one review, ONE submit, one activity and two blocks', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores', 'Ciberseguridad']);
  const confirms: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/capture/confirm')) confirms.push(r.url());
  });
  await write(page, MIXED);

  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText('Parcial');
  await expect(cards(page).nth(1)).toContainText('Horario semanal');
  await expect(button(page, 'Crear 1 actividad y 2 bloques')).toBeEnabled();

  await button(page, 'Crear 1 actividad y 2 bloques').click();
  await expect(
    quick(page)
      .getByRole('status')
      .filter({ hasText: '1 actividad creada y 2 bloques de horario creados.' }),
  ).toBeVisible();
  expect(confirms).toHaveLength(1);
  expect((await activities(page)).map((a) => a.title)).toEqual(['Parcial']);
  expect((await week(page)).map((o) => lived(o).weekday).sort()).toEqual([2, 4]);
  assertClean();
});

test('D. "Tengo un quiz todos los viernes": explained, no tick, no block, no activities', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, 'Tengo un quiz todos los viernes');

  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText(
    'Parece una actividad que se repite cada viernes. La repetición automática de actividades todavía no está disponible.',
  );
  await expect(cards(page).first().getByRole('checkbox')).toHaveCount(0);
  await expect(button(page, /^Crear/)).toBeDisabled();
  expect(await week(page)).toHaveLength(0);
  expect(await activities(page)).toHaveLength(0);

  await cards(page)
    .first()
    .getByRole('button', { name: /^Quitar/ })
    .click();
  await expect(cards(page)).toHaveCount(0);
  assertClean();
});

test('E. the same weekly class written again is not duplicated: "ya estaba en tu horario"', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await write(page, CIBER);
  await button(page, 'Crear horario').click();
  await expect(quick(page).getByRole('status').filter({ hasText: '2 bloques' })).toBeVisible();

  await write(page, CIBER);
  await button(page, 'Crear horario').click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '2 bloques ya estaban en tu horario.' }),
  ).toBeVisible();
  expect(await week(page)).toHaveLength(2);
  assertClean();
});

test('F. a mixed review survives leaving the page and a reload, with the answer already given', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores']);
  const parses: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/capture/parse')) parses.push(r.url());
  });
  await write(
    page,
    'Tengo un parcial de redes el viernes a las 8 am y clase de redes todos los lunes a las 7 am',
  );
  await quick(page).getByLabel('Hora final', { exact: true }).fill('09:00');
  await expect(cards(page).nth(1)).toContainText('7:00 a. m. – 9:00 a. m.');

  await page.goto('/activities');
  await expect(page.getByRole('heading', { level: 1, name: 'Actividades' })).toBeVisible();
  await page.goto('/dashboard');
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(1)).toContainText('Todos los lunes · 7:00 a. m. – 9:00 a. m.');

  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(1)).toContainText('Todos los lunes · 7:00 a. m. – 9:00 a. m.');
  await expect(button(page, 'Crear 1 actividad y 1 bloque')).toBeVisible();
  expect(parses).toHaveLength(1); // nothing was interpreted again
  assertClean();
});

test('G. a subject that does not exist is created only when everything is confirmed', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores']);
  await write(page, 'Tengo Mecánica Cuántica todos los lunes de 7 a 9');

  await expect(quick(page).getByText('No tienes la asignatura «Mecánica Cuántica».')).toBeVisible();
  // a weekly class cannot be "sin asignatura"
  await expect(cards(page).first().getByRole('button', { name: 'Sin asignatura' })).toHaveCount(0);
  await button(page, 'Crear «Mecánica Cuántica»').click();
  await expect(
    quick(page).getByText('Se creará la asignatura «Mecánica Cuántica» al confirmar.'),
  ).toBeVisible();
  expect(await subjectNames(page)).toEqual(['Redes de Computadores']); // still nothing created

  await button(page, 'Crear horario').click();
  await expect(quick(page).getByRole('status').filter({ hasText: '1 bloque' })).toBeVisible();
  expect((await subjectNames(page)).sort()).toEqual(['Mecánica Cuántica', 'Redes de Computadores']);
  expect(await week(page)).toHaveLength(1);
  assertClean();
});

test('H. a schedule the student unticks is not created and does not block the activity that is ticked', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores', 'Ciberseguridad']);
  await write(page, MIXED);

  await cards(page)
    .nth(1)
    .getByRole('checkbox', { name: /^Incluir .*horario semanal/ })
    .uncheck();
  await expect(button(page, 'Crear 1 actividad')).toBeEnabled();
  await button(page, 'Crear 1 actividad').click();
  await expect(
    quick(page).getByRole('status').filter({ hasText: '1 actividad creada.' }),
  ).toBeVisible();
  expect((await activities(page)).map((a) => a.title)).toEqual(['Parcial']);
  expect(await week(page)).toHaveLength(0);
  // the schedule is still there to be dealt with
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Horario semanal');
  assertClean();
});

test('I. the weekly review fits every width, has 44 px targets and passes axe', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertClean = watch(page);
  await newUser(page, ['Redes de Computadores', 'Ciberseguridad']);
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await write(page, MIXED);
    await expect(cards(page)).toHaveCount(2);
    await cards(page).nth(1).getByRole('button', { name: 'Editar' }).click();
    await expectNoHorizontalOverflow(page);
    const small = await quick(page)
      .locator(
        'button, input[type="checkbox"], summary, select, input:not([type="checkbox"]), textarea',
      )
      .evaluateAll((els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const box = (el.closest('label') ?? el).getBoundingClientRect();
            return r.width > 0 && Math.max(r.height, box.height) < 43.5;
          })
          .map((el) => `${el.tagName} ${el.textContent?.slice(0, 20) ?? ''}`),
      );
    expect(small, `controls under 44 px at ${width}`).toEqual([]);
    await page.waitForTimeout(700);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      `axe at ${width}`,
    ).toEqual([]);
    await button(page, 'Descartar').click();
  }
  assertClean();
});
