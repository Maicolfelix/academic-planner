import { addDays, weekdayOf, weekRangeOf } from '@planner/core';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiCreateSubject,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

// A period that always contains "today" and the weeks around it (the system clock decides what today is).
const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const thisWeek = () => weekRangeOf(bogotaToday());
const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const isMobile = (page: Page) => page.viewportSize()!.width < 768;
const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

async function newUser(page: Page, subjects: string[] = ['Redes', 'Bases de Datos']) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  for (const name of subjects) await addSubjectViaUi(page, name);
}

const subjectId = async (page: Page, name: string) =>
  (await apiSubjects(page)).find((s) => s.name === name)!.id;

type Status = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

/** `n` activities of a subject, far from the current week; the first `completed` of them are finished. */
async function activities(
  page: Page,
  subject: string,
  n: number,
  completed: number,
  tag = subject,
) {
  const id = await subjectId(page, subject);
  for (let i = 0; i < n; i++) {
    const a = await apiCreateActivity(page, {
      subjectId: id,
      title: `${tag} actividad ${i + 1}`,
      dueDate: bogotaToday(40 + i),
    });
    if (i < completed) {
      const res = await page.request.patch(`/api/activities/${a.id}`, {
        data: { status: 'COMPLETED' as Status },
      });
      expect(res.status()).toBe(200);
    }
  }
}

async function block(
  page: Page,
  data: {
    type: 'CLASS' | 'STUDY' | 'ACADEMIC_PERSONAL';
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    subject?: string;
  },
) {
  const { subject, ...rest } = data;
  const res = await page.request.post('/api/schedule', {
    data: { ...rest, ...(subject ? { subjectId: await subjectId(page, subject) } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
}

const weekCard = (page: Page) => page.getByRole('region', { name: 'Esta semana' });
const progressCard = (page: Page) => page.getByRole('region', { name: 'Progreso de actividades' });
const row = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });

test('progress and weekly workload: from the Dashboard to the detail, and live updates', async ({
  page,
}) => {
  const assertClean = watch(page);
  const week = thisWeek();
  const [monday, tuesday, wednesday] = [week.from, addDays(week.from, 1), addDays(week.from, 2)];

  // 1-4. New user, current period, subjects "Redes" and "Bases de Datos".
  await newUser(page);

  // 5-6. Activities: Redes 3 of 4 finished, Bases 1 of 6 finished; plus a subject with none.
  await activities(page, 'Redes', 4, 3);
  await activities(page, 'Bases de Datos', 6, 1);
  await apiCreateSubject(page, 'Vacía');

  // 7. General progress on the Dashboard: 4 of 10 = 40 %.
  await page.goto('/dashboard');
  await expect(progressCard(page)).toContainText('40%');
  await expect(progressCard(page)).toContainText('4 de 10 actividades finalizadas');

  // 8-9. "Ver progreso por asignatura": each subject has its own figures, in alphabetical order.
  await progressCard(page).getByRole('link', { name: 'Ver progreso por asignatura' }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Progreso y carga semanal' }),
  ).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Progreso general de actividades' }),
  ).toHaveAttribute('aria-valuenow', '40');
  const bases = row(page, 'Bases de Datos');
  const redes = row(page, 'Redes');
  await expect(bases).toContainText('1 de 6 completadas');
  await expect(bases).toContainText('17%');
  await expect(bases.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '17');
  await expect(redes).toContainText('3 de 4 completadas');
  await expect(redes).toContainText('75%');
  await expect(redes.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  await expect(row(page, 'Vacía')).toContainText('Sin actividades registradas');
  await expect(row(page, 'Vacía').getByRole('progressbar')).toHaveCount(0); // no bar: "no data" is not "0 %"
  const order = await page.locator('main li p.font-medium').allInnerTexts();
  expect(order.filter((t) => ['Bases de Datos', 'Redes', 'Vacía'].includes(t))).toEqual([
    'Bases de Datos',
    'Redes',
    'Vacía',
  ]);

  // 10-12. This week: two classes (Mon, Wed 08-10), a study session (Tue 14-16) and a deadline on Wednesday.
  await block(page, {
    type: 'CLASS',
    title: 'Clase de Redes lunes',
    date: monday,
    startTime: '08:00',
    endTime: '10:00',
    subject: 'Redes',
  });
  await block(page, {
    type: 'STUDY',
    title: 'Estudio de Bases',
    date: tuesday,
    startTime: '14:00',
    endTime: '16:00',
  });
  await block(page, {
    type: 'CLASS',
    title: 'Clase de Bases miércoles',
    date: wednesday,
    startTime: '08:00',
    endTime: '10:00',
    subject: 'Bases de Datos',
  });
  await apiCreateActivity(page, {
    subjectId: await subjectId(page, 'Redes'),
    title: 'Entrega de la semana',
    dueDate: wednesday,
    dueTime: '18:00',
  });

  // 13-17. Back on the Dashboard: "Esta semana" says what is registered, nothing more.
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    weekCard(page).getByRole('heading', { level: 2, name: 'Esta semana' }),
  ).toBeVisible();
  await expect(weekCard(page)).toContainText('4 compromisos');
  await expect(weekCard(page)).toContainText('6 h programadas');
  await expect(weekCard(page)).toContainText('Día con más compromisos: Miércoles — 2');
  await expect(weekCard(page)).toContainText(
    '1 entrega pendiente · 2 clases · 1 sesión de estudio',
  );
  await expect(weekCard(page)).toContainText('Se basa solo en lo que has registrado.');
  await expect(weekCard(page)).not.toContainText(
    /sobrecarg|estr[eé]s|demasiado|deber[ií]as|productiv/i,
  );
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
  const samePage = () =>
    page.evaluate(() => (window as unknown as { __kept?: number }).__kept === 1);

  // 18. "Ver semana" opens the Agenda on that very week.
  await weekCard(page).getByRole('link', { name: 'Ver semana' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?week=${week.from}$`));

  // 19. Change a class: Monday 08:00-10:00 becomes 08:00-11:00.
  if (isMobile(page)) {
    await page
      .getByRole('button', {
        name: new RegExp(`^${WEEKDAYS[weekdayOf(monday) - 1]} ${Number(monday.slice(8))}\\b`),
      })
      .click();
  }
  await page.getByRole('button', { name: /Clase de Redes lunes/ }).click();
  const edit = page.getByRole('dialog', { name: 'Editar bloque' });
  await edit.getByLabel('Fin', { exact: true }).fill('11:00');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toBeHidden();

  // 20. Without reloading, the load changed: 7 h programadas.
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(weekCard(page)).toContainText('7 h programadas');
  await expect(weekCard(page)).toContainText('4 compromisos');
  expect(await samePage()).toBe(true);

  // 21-22. Delete the deadline: one commitment less, still no reload.
  await nav(page).getByRole('link', { name: 'Actividades' }).click();
  await page.getByRole('button', { name: 'Eliminar Entrega de la semana' }).click();
  await page
    .getByRole('dialog', { name: '¿Eliminar Entrega de la semana?' })
    .getByRole('button', { name: 'Eliminar' })
    .click();
  await expect(row(page, 'Entrega de la semana')).toHaveCount(0);
  await nav(page).getByRole('link', { name: 'Inicio' }).click();
  await expect(weekCard(page)).toContainText('3 compromisos');
  await expect(weekCard(page)).toContainText('0 entregas pendientes');
  await expect(progressCard(page)).toContainText('4 de 10 actividades finalizadas');
  expect(await samePage()).toBe(true);

  // 23. The detail page: week navigation, day list, and a 360 px layout without sideways scrolling.
  await weekCard(page).getByRole('link', { name: 'Ver detalle por día' }).click();
  await expect(page).toHaveURL(new RegExp(`/progress\\?week=${week.from}$`));
  const days = page.getByRole('list', { name: 'Detalle por día' }).getByRole('listitem');
  await expect(days).toHaveCount(7);
  await expect(days.nth(0)).toContainText('Lunes');
  await expect(days.nth(0)).toContainText('1 bloque de agenda · 3 h programadas');
  await expect(days.nth(1)).toContainText('2 h programadas');
  // Every day has one commitment; Monday holds the most scheduled time (3 h), so it is the busiest.
  await expect(days.nth(0)).toContainText('Día con más compromisos');
  await expect(days.nth(2)).not.toContainText('Día con más compromisos');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Semana siguiente' }).click();
  await expect(page).toHaveURL(new RegExp(`week=${addDays(week.from, 7)}`));
  await expect(page.getByText('No hay compromisos registrados en esta semana.')).toBeVisible();
  await page.getByRole('button', { name: 'Semana actual' }).click();
  await expect(page).not.toHaveURL(/week=/);
  await expect(page.getByText('3 compromisos')).toBeVisible();

  // 24. No console errors, no uncaught exceptions and no failed API calls along the whole flow.
  assertClean();
});

test('a wide data set: seven busy days, an empty one, long titles, 0 %, 100 % and a subject without activities', async ({
  page,
}) => {
  const assertClean = watch(page);
  const week = thisWeek();
  await newUser(page, [
    'Redes',
    'Álgebra lineal y geometría analítica para ingeniería de sistemas',
  ]);
  await activities(page, 'Redes', 5, 5, 'Completa'); // 100 %
  const long = 'Asignatura con un nombre bastante largo para comprobar el ajuste de línea';
  await apiCreateSubject(page, long);
  await activities(page, long, 3, 0, 'Pendiente'); // 0 % with activities
  await apiCreateSubject(page, 'Sin nada todavía'); // no activities

  // Days Monday..Sunday except Friday, with Wednesday holding many commitments and long titles.
  for (const [i, date] of [0, 1, 2, 3, 5, 6].map((n) => [n, addDays(week.from, n)] as const)) {
    const count = i === 2 ? 8 : 1;
    for (let k = 0; k < count; k++) {
      await block(page, {
        type: k % 2 ? 'STUDY' : 'ACADEMIC_PERSONAL',
        title:
          i === 2
            ? `Bloque con un título extremadamente largo número ${k + 1} para probar el ajuste`
            : `Bloque ${i}`,
        date,
        startTime: `${String(7 + k).padStart(2, '0')}:00`,
        endTime: `${String(8 + k).padStart(2, '0')}:00`,
      });
    }
  }

  await page.goto('/progress');
  await expect(page.getByRole('progressbar', { name: 'Progreso de Redes' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await expect(row(page, 'Redes')).toContainText('5 de 5 completadas');
  await expect(row(page, long)).toContainText('0 de 3 completadas');
  await expect(row(page, long).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(row(page, 'Sin nada todavía')).toContainText('Sin actividades registradas');
  await expect(row(page, 'Sin nada todavía')).not.toContainText('0%');

  const days = page.getByRole('list', { name: 'Detalle por día' }).getByRole('listitem');
  await expect(days).toHaveCount(7);
  await expect(days.nth(4)).toContainText('Viernes');
  await expect(days.nth(4)).toContainText('Sin compromisos registrados'); // the empty day
  await expect(days.nth(2)).toContainText('8 compromisos');
  await expect(days.nth(2)).toContainText('Día con más compromisos');
  await expect(
    page.getByRole('list', { name: 'Compromisos por día' }).getByRole('listitem'),
  ).toHaveCount(7);
  await expect(page.getByText('Día con más compromisos: Miércoles — 8')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/dashboard');
  await expect(weekCard(page)).toContainText('13 compromisos');
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('no activities at all: calm empty states instead of 0 %', async ({ page }) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes']);
  await page.goto('/progress');
  await expect(page.getByText('Sin actividades registradas').first()).toBeVisible();
  await expect(page.getByText('0%')).toHaveCount(0);
  await expect(page.getByText('No hay compromisos registrados en esta semana.')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Compromisos por día' }).getByRole('listitem'),
  ).toHaveCount(7);
  await expectNoHorizontalOverflow(page);
  assertClean();
});

test('accessibility: progress bars, textual chart, headings and keyboard', async ({ page }) => {
  const assertClean = watch(page);
  const week = thisWeek();
  await newUser(page, ['Redes']);
  await activities(page, 'Redes', 2, 1);
  await block(page, {
    type: 'STUDY',
    title: 'Estudio',
    date: week.from,
    startTime: '08:00',
    endTime: '09:30',
  });

  await page.goto('/progress');
  for (const bar of await page.getByRole('progressbar').all()) {
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    await expect(bar).toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(bar).toHaveAccessibleName(/\S/);
    await expect(bar).toHaveAttribute('aria-valuetext', /actividades completadas/);
  }
  // One h1; the sections are h2.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Progreso de actividades' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Carga semanal' })).toBeVisible();
  // The chart has its text: every day announces its name and its number.
  const chart = page.getByRole('list', { name: 'Compromisos por día' }).getByRole('listitem');
  await expect(chart.nth(0)).toContainText('Lunes: 1 compromiso');
  await expect(chart.nth(6)).toContainText('Domingo: 0 compromisos');
  // Keyboard: the week buttons are reachable and work with Enter.
  const next = page.getByRole('button', { name: 'Semana siguiente' });
  await next.focus();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`week=${addDays(week.from, 7)}`));
  assertClean();
});

test('the week follows the profile timezone, not the browser’s', async ({ browser }) => {
  // The browser believes it is in Tokyo (UTC+9); the profile is Bogotá (UTC-5).
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const assertClean = watch(page);
  const week = thisWeek();
  await newUser(page, ['Redes']);
  const wednesday = addDays(week.from, 2);
  // Wednesday 22:00 in Bogotá is already Thursday 12:00 in Tokyo.
  await apiCreateActivity(page, {
    subjectId: await subjectId(page, 'Redes'),
    title: 'Tarde en Bogotá',
    dueDate: wednesday,
    dueTime: '22:00',
  });
  await page.goto('/dashboard');
  await expect(weekCard(page)).toContainText('1 compromiso');
  await expect(weekCard(page)).toContainText('Día con más compromisos: Miércoles — 1');
  assertClean();
  await context.close();
});
