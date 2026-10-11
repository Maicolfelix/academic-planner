import AxeBuilder from '@axe-core/playwright';
import { addDays, weekdayOf, weekRangeOf } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  entrancesDone,
  expectNoHorizontalOverflow,
  openActivityMenu,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * The Agenda draws two things on the same days: the schedule blocks and the student's OPEN activities (the same records
 * as the Activities page, read with one range query per week). Phones show one day at a time, desktop the whole week.
 */

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const isPhone = (page: Page) => page.viewportSize()!.width < 1024;
const thisMonday = () => weekRangeOf(bogotaToday()).from;
/** NEXT week: every day of it is in the future, whatever day the suite runs on (nothing there is overdue). */
const nextMonday = () => addDays(thisMonday(), 7);
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await addSubjectViaUi(page, 'Redes');
  return (await apiSubjects(page))[0]!;
}

const goAgenda = async (page: Page) => {
  await nav(page).getByRole('link', { name: 'Agenda' }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible();
};
const openWeek = async (page: Page, monday: string) => {
  await page.goto(`/calendar?week=${monday}`);
  await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible();
};
const goActivities = async (page: Page) => {
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await expect(page).toHaveURL(/\/activities$/);
};

/** Phones show one day at a time: pick it first. Desktop already shows the whole week. */
async function showDay(page: Page, date: string) {
  if (!isPhone(page)) return;
  await page
    .getByRole('button', {
      name: new RegExp(`^${DAYS[weekdayOf(date) - 1]} ${Number(date.slice(8))}\\b`),
    })
    .click();
}

/** An activity of the Agenda, by its title, in either layout. */
const activityItem = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}, actividad`) });

const make = (page: Page, subjectId: string | null, title: string, extra: object) =>
  apiCreateActivity(page, { ...(subjectId ? { subjectId } : {}), title, type: 'TASK', ...extra });

test('A. an activity with an hour is at its day and its hour, as an activity', async ({ page }) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const tuesday = addDays(nextMonday(), 1);
  await make(page, redes.id, 'Parcial de Redes', {
    type: 'EXAM',
    dueDate: tuesday,
    dueTime: '14:00',
  });
  await openWeek(page, nextMonday());
  await showDay(page, tuesday);

  const item = activityItem(page, 'Parcial de Redes');
  await expect(item).toBeVisible();
  await expect(item).toHaveAccessibleName(/actividad \(parcial\), martes, 2:00 p\. m\.$/i);
  if (isPhone(page)) {
    await expect(item).toContainText('2:00 p. m.');
    await expect(item).toContainText('Actividad · Parcial · Redes · Pendiente');
  } else {
    // positioned in the grid at 14:00 (07:00 is the first row, 48 px per hour)
    const top = await item.evaluate((el) => (el.parentElement as HTMLElement).offsetTop);
    expect(top).toBe((14 - 7) * 48);
  }
  assertClean();
});

test('B. an activity with no hour is not lost: "Sin hora", above the day', async ({ page }) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const tuesday = addDays(nextMonday(), 1);
  await make(page, redes.id, 'Informe de laboratorio', { dueDate: tuesday });
  await make(page, null, 'Trámite general', { dueDate: tuesday }); // an activity with no subject too
  await openWeek(page, nextMonday());
  await showDay(page, tuesday);

  await expect(activityItem(page, 'Informe de laboratorio')).toHaveAccessibleName(
    /martes, sin hora$/i,
  );
  await expect(activityItem(page, 'Trámite general')).toBeVisible();
  if (isPhone(page)) {
    await expect(page.getByRole('heading', { name: 'Sin hora', level: 3 })).toBeVisible();
  } else {
    const row = page.getByRole('list', {
      name: new RegExp(`^Sin hora, Martes ${Number(tuesday.slice(8))}`),
    });
    await expect(row.getByRole('button')).toHaveCount(2);
  }
  assertClean();
});

test('C. a class block and an activity on the same day are both there', async ({ page }) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const wednesday = addDays(nextMonday(), 2);
  const res = await page.request.post('/api/schedule', {
    data: {
      type: 'CLASS',
      subjectId: redes.id,
      title: 'Clase de Redes',
      date: wednesday,
      startTime: '10:00',
      endTime: '12:00',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  await make(page, redes.id, 'Taller de subredes', {
    type: 'WORKSHOP',
    dueDate: wednesday,
    dueTime: '10:30',
  });
  await make(page, redes.id, 'Quiz sin hora', { type: 'QUIZ', dueDate: wednesday });
  await openWeek(page, nextMonday());
  await showDay(page, wednesday);

  await expect(page.getByRole('button', { name: /Clase de Redes/ })).toBeVisible();
  await expect(activityItem(page, 'Taller de subredes')).toBeVisible(); // at 10:30, over the class: side by side
  await expect(activityItem(page, 'Quiz sin hora')).toBeVisible();
  // not empty, and the legend explains the two looks
  await expect(page.getByText('No tienes nada programado esta semana.')).toHaveCount(0);
  await expect(page.getByText('Clase o bloque')).toBeVisible();
  await expect(page.getByText('Actividad', { exact: true })).toBeVisible();
  assertClean();
});

test('D. a finished activity is not in the Agenda; finishing one makes it leave without a reload', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const thursday = addDays(thisMonday(), 3);
  const done = await make(page, redes.id, 'Ya entregada', { dueDate: thursday, dueTime: '09:00' });
  await make(page, redes.id, 'Por entregar', { dueDate: thursday, dueTime: '11:00' });
  expect(
    (
      await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } })
    ).ok(),
  ).toBe(true);
  await goAgenda(page);
  await showDay(page, thursday);
  await expect(activityItem(page, 'Por entregar')).toBeVisible();
  await expect(activityItem(page, 'Ya entregada')).toHaveCount(0);

  // finish the other one from the Activities page and come back, in the same session (no reload)
  await goActivities(page);
  await page.getByRole('button', { name: 'Completar Por entregar' }).click();
  await expect(page.getByLabel('Cambiar estado de Por entregar')).toHaveValue('COMPLETED');
  await goAgenda(page);
  await showDay(page, thursday);
  await expect(activityItem(page, 'Por entregar')).toHaveCount(0);
  assertClean();
});

test('E. an open activity that is already overdue stays on the day it was due, marked', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const lastWeek = addDays(thisMonday(), -7);
  const wednesday = addDays(lastWeek, 2);
  await make(page, redes.id, 'Entrega atrasada', { dueDate: wednesday, dueTime: '10:00' });
  await page.goto(`/calendar?week=${lastWeek}`);
  await showDay(page, wednesday);
  const item = activityItem(page, 'Entrega atrasada');
  await expect(item).toBeVisible();
  await expect(item).toHaveAccessibleName(/vencida$/);
  await expect(item).toContainText('Vencida');
  // it is not moved to today: this week has nothing
  await page.getByRole('button', { name: 'Hoy' }).click();
  await expect(activityItem(page, 'Entrega atrasada')).toHaveCount(0);
  await expect(page.getByText('No tienes nada programado esta semana.')).toBeVisible();
  assertClean();
});

test('F. changing the week changes the activities with the blocks (one range query per week)', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const prev = addDays(thisMonday(), -7 + 1);
  const cur = addDays(thisMonday(), 1);
  const next = addDays(thisMonday(), 7 + 1);
  await make(page, redes.id, 'De la semana pasada', { dueDate: prev, dueTime: '08:00' });
  await make(page, redes.id, 'De esta semana', { dueDate: cur, dueTime: '08:00' });
  await make(page, redes.id, 'De la próxima', { dueDate: next, dueTime: '08:00' });

  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/activities?')) requests.push(new URL(r.url()).search);
  });
  await goAgenda(page);
  await showDay(page, cur);
  await expect(activityItem(page, 'De esta semana')).toBeVisible();
  await expect(activityItem(page, 'De la próxima')).toHaveCount(0);

  await page.getByRole('button', { name: 'Siguiente' }).click();
  await showDay(page, next);
  await expect(activityItem(page, 'De la próxima')).toBeVisible();
  await expect(activityItem(page, 'De esta semana')).toHaveCount(0);

  await page.getByRole('button', { name: 'Anterior' }).click();
  await page.getByRole('button', { name: 'Anterior' }).click();
  await showDay(page, prev);
  await expect(activityItem(page, 'De la semana pasada')).toBeVisible();

  await page.getByRole('button', { name: 'Hoy' }).click();
  await showDay(page, cur);
  await expect(activityItem(page, 'De esta semana')).toBeVisible();
  // one request per visited week (never one per day): ranges of seven days
  expect(requests.length).toBeLessThanOrEqual(6);
  for (const search of requests) {
    const q = new URLSearchParams(search);
    expect(q.has('from') && q.has('to')).toBe(true);
    expect(weekdayOf(q.get('from')!)).toBe(1);
    expect(weekdayOf(q.get('to')!)).toBe(7);
  }
  assertClean();
});

test('G. editing the date moves it; I. clicking it opens the SAME form as in Activities', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const tuesday = addDays(thisMonday(), 1);
  const friday = addDays(thisMonday(), 4);
  await make(page, redes.id, 'Mover de día', { dueDate: tuesday, dueTime: '15:00' });
  await goAgenda(page);
  await showDay(page, tuesday);
  await activityItem(page, 'Mover de día').click();

  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Título')).toHaveValue('Mover de día');
  await expect(dialog.getByLabel('Fecha')).toHaveValue(tuesday);
  await dialog.getByLabel('Fecha').fill(friday);
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();

  // gone from Tuesday, there on Friday: no reload
  await showDay(page, tuesday);
  // a phone shows one day at a time (Tuesday is empty now); the desktop week shows it, once, on Friday
  await expect(activityItem(page, 'Mover de día')).toHaveCount(isPhone(page) ? 0 : 1);
  await showDay(page, friday);
  await expect(activityItem(page, 'Mover de día')).toBeVisible();
  await expect(activityItem(page, 'Mover de día')).toHaveAccessibleName(/viernes, 3:00 p\. m\./i);
  assertClean();
});

test('H. finishing from the form and deleting from Activities both update the Agenda', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const monday = thisMonday();
  await make(page, redes.id, 'Para finalizar', { dueDate: monday, dueTime: '08:00' });
  await make(page, redes.id, 'Para eliminar', { dueDate: monday, dueTime: '09:00' });
  await goAgenda(page);
  await showDay(page, monday);

  await activityItem(page, 'Para finalizar').click();
  const dialog = page.getByRole('dialog', { name: 'Editar actividad' });
  await dialog.getByLabel('Estado').selectOption('COMPLETED');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toBeHidden();
  await expect(activityItem(page, 'Para finalizar')).toHaveCount(0);
  await expect(activityItem(page, 'Para eliminar')).toBeVisible();

  await goActivities(page);
  await openActivityMenu(page, 'Para eliminar');
  await page.getByRole('menuitem', { name: 'Eliminar Para eliminar' }).click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Para eliminar?' })
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Para eliminar' })).toHaveCount(0);
  await goAgenda(page);
  await showDay(page, monday);
  await expect(activityItem(page, 'Para eliminar')).toHaveCount(0);
  assertClean();
});

test('a new activity from the Activities page shows up in the Agenda without a reload, and the blocks keep working', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const thursday = addDays(thisMonday(), 3);
  await goAgenda(page); // the week is loaded (and empty) first
  await expect(page.getByText('No tienes nada programado esta semana.')).toBeVisible();
  await goActivities(page);
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill('Creada desde Actividades');
  await dialog.getByLabel('Fecha').fill(thursday);
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await goAgenda(page);
  await showDay(page, thursday);
  await expect(activityItem(page, 'Creada desde Actividades')).toBeVisible();
  await expect(page.getByText('No tienes nada programado esta semana.')).toHaveCount(0);

  // a block still opens its own editor (not the activity's)
  const res = await page.request.post('/api/schedule', {
    data: {
      type: 'STUDY',
      subjectId: redes.id,
      title: 'Estudio de Redes',
      date: thursday,
      startTime: '16:00',
      endTime: '17:00',
    },
  });
  expect(res.status()).toBe(201);
  await page.reload();
  await showDay(page, thursday);
  await page.getByRole('button', { name: /Estudio de Redes/ }).click();
  await expect(page.getByRole('dialog', { name: 'Editar bloque' })).toBeVisible();
  assertClean();
});

test('J. the empty state: nothing at all says so; only blocks, or only activities, do not', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const wednesday = addDays(nextMonday(), 2);
  await openWeek(page, nextMonday());
  await expect(page.getByText('No tienes nada programado esta semana.')).toBeVisible();

  // only an activity
  await make(page, redes.id, 'Solo actividad', { dueDate: wednesday });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible();
  await expect(page.getByText('No tienes nada programado esta semana.')).toHaveCount(0);
  await showDay(page, wednesday);
  await expect(activityItem(page, 'Solo actividad')).toBeVisible();

  // only a block (finish the activity: the week keeps one block and no activity)
  const act = (await (await page.request.get('/api/activities')).json()).activities[0] as {
    id: string;
  };
  await page.request.patch(`/api/activities/${act.id}`, { data: { status: 'COMPLETED' } });
  await page.request.post('/api/schedule', {
    data: {
      type: 'CLASS',
      subjectId: redes.id,
      title: 'Solo bloque',
      date: wednesday,
      startTime: '08:00',
      endTime: '09:00',
    },
  });
  await page.reload();
  await expect(page.getByText('No tienes nada programado esta semana.')).toHaveCount(0);
  await showDay(page, wednesday);
  await expect(page.getByRole('button', { name: /Solo bloque/ })).toBeVisible();
  await expect(page.getByText('Clase o bloque')).toHaveCount(0); // no activity: no legend noise
  assertClean();
});

for (const width of [390, 768, 1366]) {
  test(`the Agenda with activities at ${width} px: no overflow, long titles fit, axe passes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const redes = await newUser(page);
    const tuesday = addDays(nextMonday(), 1);
    const long = `Entrega ${'muy larga '.repeat(8)}Supercalifragilisticoespialidosoynadamás`;
    await make(page, redes.id, long, { dueDate: tuesday, dueTime: '14:00' });
    await make(page, redes.id, 'Sin hora larga '.repeat(4), { dueDate: tuesday });
    await make(page, null, 'General', { dueDate: tuesday, dueTime: '14:15' });
    await page.request.post('/api/schedule', {
      data: {
        type: 'CLASS',
        subjectId: redes.id,
        title: 'Clase',
        date: tuesday,
        startTime: '14:00',
        endTime: '16:00',
      },
    });
    await openWeek(page, nextMonday());
    await showDay(page, tuesday);
    await expect(page.getByText('Clase o bloque')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await entrancesDone(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
