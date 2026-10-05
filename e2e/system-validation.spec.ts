/* eslint-disable @typescript-eslint/no-explicit-any -- the oracle reads raw API JSON; its shapes are validated by their own schemas in the API tests */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '../apps/api/src/db/prisma';
import { getTestDatabaseUrl } from '../apps/api/test/testDb';
import { twoClassTable } from '../apps/api/test/scheduleImportFixtures';
import {
  PASSWORD,
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  inBogota,
  login,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Phase 17: the product validated as a whole. One long story that a real student would live (the MASTER scenario),
 * plus the cross-cutting stories around it. Everything is built through the UI; the API and the database are used
 * as independent ORACLES (to check what the screens say) and to simulate the passing of time.
 */

const SUBJECTS = ['Redes', 'Bases de Datos', 'Bioestadística', 'Epidemiología', 'Farmacología'];
const DAY_NAMES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name });
const flat = (s: string) => s.replace(/\s+/g, ' ');
const localDow = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Bogota', weekday: 'long' });
const localTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
  });
const dayName = (plusDays: number) => {
  const d = new Date(`${bogotaToday(plusDays)}T12:00:00Z`).getUTCDay();
  return DAY_NAMES[(d + 6) % 7]!;
};

interface Api {
  activities: {
    id: string;
    title: string;
    type: string;
    subjectId: string;
    status: string;
    dueAt: string;
    hasTime: boolean;
  }[];
  dashboard: Record<string, any>;
  radar: Record<string, any>;
  attention: Record<string, any>;
  progress: Record<string, any>;
  workload: Record<string, any>;
  schedule: any[];
  due: { total: number; reminders: { id: string }[] };
}

async function oracle(page: Page): Promise<Api> {
  const get = async (p: string) => (await page.request.get(p)).json();
  const today = bogotaToday();
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const from = monday.toISOString().slice(0, 10);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return {
    activities: (await get('/api/activities')).activities,
    dashboard: (await get('/api/dashboard')).dashboard,
    radar: (await get('/api/radar')).radar,
    attention: (await get('/api/attention')).attention,
    progress: (await get('/api/progress')).progress,
    workload: (await get('/api/workload')).workload,
    schedule: (await get(`/api/schedule?from=${from}&to=${monday.toISOString().slice(0, 10)}`))
      .occurrences,
    due: await get('/api/reminders/due'),
  };
}

/** Moves reminders into the past directly in the TEST database: the way time would. */
async function makeDue(email: string, activityTitle: string) {
  const prisma = createPrisma(getTestDatabaseUrl());
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { count } = await prisma.reminder.updateMany({
      where: { userId: user.id, status: 'PENDING', activity: { title: activityTitle } },
      data: { remindAt: new Date(Date.now() - 60_000) },
    });
    return count;
  } finally {
    await prisma.$disconnect();
  }
}

async function integrity(email: string) {
  const prisma = createPrisma(getTestDatabaseUrl());
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const activities = await prisma.activity.findMany({
      where: { userId: user.id },
      include: { subject: true },
    });
    const blocks = await prisma.scheduleBlock.findMany({
      where: { userId: user.id },
      include: { period: true, subject: true },
    });
    const reminders = await prisma.reminder.findMany({
      where: { userId: user.id },
      include: { activity: true },
    });
    const periods = await prisma.academicPeriod.findMany({ where: { userId: user.id } });
    return {
      foreignSubject: activities.filter((a) => a.subject.userId !== user.id).length,
      incoherentCompletion: activities.filter(
        (a) => (a.status === 'COMPLETED') !== (a.completedAt !== null),
      ).length,
      blockOutsidePeriod: blocks.filter(
        (b) => b.subject?.periodId !== b.periodId || b.period.userId !== user.id,
      ).length,
      foreignReminder: reminders.filter((r) => r.activity.userId !== user.id).length,
      pendingOnCompleted: reminders.filter(
        (r) => r.activity.status === 'COMPLETED' && r.status === 'PENDING',
      ).length,
      currentPeriods: periods.filter((p) => p.isCurrent).length,
    };
  } finally {
    await prisma.$disconnect();
  }
}

/** A brand-new student: registered, with the current period and the five subjects, all through the screens. */
async function newStudent(page: Page) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Segundo semestre', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  for (const name of SUBJECTS) await addSubjectViaUi(page, name);
  return email;
}

async function createViaUi(
  page: Page,
  a: { title: string; subject: string; type: string; date: string; time: string },
) {
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await dialog.getByLabel('Título').fill(a.title);
  await dialog.getByLabel('Asignatura').selectOption({ label: a.subject });
  await dialog.getByLabel('Fecha').fill(a.date);
  await dialog.getByText('Más opciones').click();
  await dialog.getByLabel('Hora (opcional)').fill(a.time);
  await dialog.getByLabel('Tipo').selectOption({ label: a.type });
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: a.title })).toBeVisible();
}

const setStatus = async (page: Page, title: string, label: string) => {
  await page.goto('/activities');
  const select = page.getByLabel(`Cambiar estado de ${title}`);
  await select.selectOption({ label });
  await expect(select).toHaveValue(
    label === 'Finalizada' ? 'COMPLETED' : label === 'Pendiente' ? 'PENDING' : 'IN_PROGRESS',
  );
};

const radarCount = (radar: Api['radar'], key: string) =>
  (radar.summary as Record<string, number>)[key]!;
const attentionTitle = (a: Api['attention']) =>
  a.recommendation?.activity.title as string | undefined;

// ───────────────────────── THE MASTER SCENARIO ─────────────────────────

test('MASTER: a student builds a semester, works with it, finishes things, closes the browser and comes back', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const assertClean = watch(page);

  // E2E-01/02 — registration, onboarding, period and subjects.
  const email = await newStudent(page);
  await page.goto('/subjects');
  for (const name of SUBJECTS)
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  const periods = (await (await page.request.get('/api/periods')).json()).periods as {
    isCurrent: boolean;
    name: string;
  }[];
  expect(periods).toHaveLength(1);
  expect(periods[0]).toMatchObject({ isCurrent: true, name: 'Segundo semestre' });
  const subjects = await apiSubjects(page);
  expect(subjects.map((s) => s.name).sort()).toEqual([...SUBJECTS].sort());
  expect(new Set(subjects.map((s) => s.periodId)).size).toBe(1); // all in the one current period
  const sid = (name: string) => subjects.find((s) => s.name === name)!.id;

  // E2E-03 — manual activities: three through the dialog, two through the API (a past date and a 6-hour one).
  await createViaUi(page, {
    title: 'Tarea de subredes',
    subject: 'Redes',
    type: 'Tarea',
    date: bogotaToday(10),
    time: '10:00',
  });
  await createViaUi(page, {
    title: 'Parcial de Bases',
    subject: 'Bases de Datos',
    type: 'Parcial',
    date: bogotaToday(2),
    time: '10:00',
  });
  await createViaUi(page, {
    title: 'Proyecto integrador',
    subject: 'Epidemiología',
    type: 'Proyecto',
    date: bogotaToday(5),
    time: '10:00',
  });
  await apiCreateActivity(page, {
    subjectId: sid('Bioestadística'),
    title: 'Lectura atrasada',
    type: 'READING',
    dueDate: bogotaToday(-1),
    priority: 'HIGH',
  });
  await apiCreateActivity(page, {
    subjectId: sid('Redes'),
    title: 'Taller express',
    type: 'WORKSHOP',
    ...inBogota(6 * 3600e3),
  });

  // E2E-04 — Quick Capture: preview, edit the title, confirm.
  await page.goto('/dashboard');
  await page
    .getByLabel('Escribe la actividad en una frase')
    .fill(`parcial redes ${dayName(4)} 10am`);
  await page.getByRole('button', { name: 'Interpretar', exact: true }).click();
  const preview = page.getByRole('group', { name: 'Vista previa de la actividad' });
  await expect(preview.getByLabel('Fecha')).toHaveValue(bogotaToday(4));
  await expect(preview.getByLabel('Hora (opcional)')).toHaveValue('10:00');
  await preview.getByLabel('Título').fill('Parcial 1 de Redes');
  await preview.getByRole('button', { name: 'Crear actividad' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Actividad creada: Parcial 1 de Redes.' }),
  ).toBeVisible();

  // E2E-05 — Academic Inbox: two proposals from one message, both created.
  await page.goto('/inbox');
  await page
    .getByLabel('Mensaje del profesor o instrucción académica')
    .fill(
      'Buenas tardes. El jueves tendremos quiz de Bases de Datos a las 8 a. m. y el viernes deben entregar el taller de Bioestadística.',
    );
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '2 creadas, 0 pendientes' }),
  ).toBeVisible();

  // E2E-06 — a manual weekly class (through the API; the dialog is covered by calendar.spec), then
  // E2E-07 — the schedule import with a known fixture.
  const manual = await page.request.post('/api/schedule', {
    data: {
      type: 'CLASS',
      subjectId: sid('Epidemiología'),
      title: 'Epidemiología',
      date: firstWeekday(4),
      startTime: '14:00',
      endTime: '16:00',
      recurrence: { frequency: 'WEEKLY', until: bogotaToday(120) },
    },
  });
  expect(manual.status(), await manual.text()).toBe(201);
  await page.goto('/calendar/import');
  await page
    .getByLabel('Archivo del horario (imagen PNG o JPG, o PDF)')
    .setInputFiles({ name: 'horario.png', mimeType: 'image/png', buffer: twoClassTable() });
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('article')).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '2 clases importadas, 0 necesitan corrección' }),
  ).toBeVisible();
  // The same file again: both classes are recognised as already in the agenda.
  await page.getByRole('button', { name: 'Subir otro archivo' }).click();
  await page
    .getByLabel('Archivo del horario (imagen PNG o JPG, o PDF)')
    .setInputFiles({ name: 'horario.png', mimeType: 'image/png', buffer: twoClassTable() });
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('article')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByText('Esta clase parece estar ya en tu agenda.')).toHaveCount(2);

  // What really exists now.
  const api = await oracle(page);
  const byTitle = (t: string) => api.activities.find((a) => a.title === t)!;
  expect(api.activities).toHaveLength(8);
  expect(byTitle('Parcial 1 de Redes')).toMatchObject({
    type: 'EXAM',
    subjectId: sid('Redes'),
    hasTime: true,
  });
  expect(localTime(byTitle('Parcial 1 de Redes').dueAt)).toBe('10:00');
  const quiz = api.activities.find((a) => a.type === 'QUIZ')!;
  const workshop = api.activities.find(
    (a) => a.type === 'WORKSHOP' && a.subjectId === sid('Bioestadística'),
  )!;
  expect(quiz).toMatchObject({ subjectId: sid('Bases de Datos'), hasTime: true });
  expect(localDow(quiz.dueAt)).toBe('Thursday');
  expect(localTime(quiz.dueAt)).toBe('08:00');
  expect(localDow(workshop.dueAt)).toBe('Friday');
  const blocks = (
    await (
      await page.request.get(`/api/schedule?from=${bogotaToday(-6)}&to=${bogotaToday(7)}`)
    ).json()
  ).occurrences as { title: string; isRecurring: boolean }[];
  expect([...new Set(blocks.map((b) => b.title))].sort()).toEqual([
    'Bases de Datos',
    'Epidemiología',
    'Redes',
  ]);
  expect(blocks.every((b) => b.isRecurring)).toBe(true);

  // E2E-26 — the Dashboard says what every other module says.
  await page.goto('/dashboard');
  await expect(region(page, '¿Qué hago ahora?')).toContainText('Lectura atrasada'); // loaded
  await expect(region(page, 'Radar académico')).toContainText('Vencidas');
  const main = async () => flat(await page.locator('main').innerText());
  const s = api.dashboard.summary as Record<string, number>;
  expect(s).toEqual({ total: 8, pending: 8, inProgress: 0, completed: 0, overdue: 1 });
  expect(await main()).toMatch(new RegExp(String.raw`${s.pending}\s*\S?\s*Pendientes`));
  expect(await main()).toMatch(/0 de 8 actividades finalizadas/);
  for (const [label, key] of [
    ['Vencidas', 'overdue'],
    ['Atención inmediata', 'immediate'],
    ['Próximas', 'upcoming'],
    ['Planificables', 'plannable'],
    ['Bajo control', 'underControl'],
  ] as const) {
    expect(await flat(await region(page, 'Radar académico').innerText()), label).toMatch(
      new RegExp(String.raw`${label}\s*\S?\s*${radarCount(api.radar, key)}`),
    );
  }
  expect(await flat(await region(page, 'Esta semana').innerText())).toContain(
    `${api.workload.totals.totalCommitments} compromisos`,
  );
  expect(api.workload.totals.totalCommitments).toBe(
    api.workload.totals.activityCount + api.workload.totals.scheduleOccurrenceCount,
  );
  expect(api.workload.totals.scheduleOccurrenceCount).toBe(api.schedule.length);

  // E2E-09 — Radar: each deliberate activity sits in exactly its band (API oracle + the Radar screen).
  const band = (key: string) => (api.radar.groups[key] as { title: string }[]).map((x) => x.title);
  expect(band('overdue')).toEqual(['Lectura atrasada']);
  expect(band('immediate')).toContain('Taller express');
  expect(band('upcoming')).toContain('Parcial de Bases');
  expect(band('plannable')).toEqual(
    expect.arrayContaining(['Proyecto integrador', 'Parcial 1 de Redes']),
  );
  expect(band('underControl')).toContain('Tarea de subredes');
  await page.goto('/radar');
  for (const [heading, key] of [
    ['Vencidas', 'overdue'],
    ['Atención inmediata', 'immediate'],
    ['Próximas', 'upcoming'],
    ['Planificables', 'plannable'],
    ['Bajo control', 'underControl'],
  ] as const) {
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: new RegExp(`^${heading}`) }),
    });
    for (const t of band(key))
      await expect(section.first(), `${t} under ${heading}`).toContainText(t);
  }

  // E2E-10 — "¿Qué hago ahora?": the overdue, high-priority activity leads; the Dashboard shows the same one.
  expect(attentionTitle(api.attention)).toBe('Lectura atrasada');
  await page.goto('/dashboard');
  await expect(region(page, '¿Qué hago ahora?')).toContainText('Lectura atrasada');

  // E2E-08 — reminders: only future automatic ones, before the deadline; due ones appear; "seen" persists.
  const exam = byTitle('Parcial de Bases');
  const remindersOf = async (id: string) =>
    (await (await page.request.get(`/api/reminders?activityId=${id}`)).json()).reminders as {
      remindAt: string;
      status: string;
      kind: string;
    }[];
  const pending = await remindersOf(exam.id);
  expect(pending.length).toBeGreaterThan(0);
  for (const r of pending) {
    expect(r.kind).toBe('AUTO');
    expect(new Date(r.remindAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(r.remindAt).getTime()).toBeLessThan(new Date(exam.dueAt).getTime());
  }
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Editar Parcial de Bases', exact: true }).click();
  const reminderItems = page
    .getByRole('dialog', { name: 'Editar actividad' })
    .getByRole('region', { name: 'Recordatorios' })
    .getByRole('listitem');
  await expect(reminderItems).toHaveCount(pending.length);
  await page.keyboard.press('Escape');
  expect(await makeDue(email, 'Parcial de Bases')).toBe(pending.length);
  await page.goto('/dashboard');
  const seenButtons = page.getByRole('button', { name: /Marcar como visto: Parcial de Bases/ });
  await expect(seenButtons.first()).toBeVisible();
  const dueBefore = (await oracle(page)).due.total;
  expect(dueBefore).toBe(pending.length);
  await seenButtons.first().click();
  await expect.poll(async () => (await oracle(page)).due.total).toBe(dueBefore - 1);
  await page.reload();
  expect((await oracle(page)).due.total).toBe(dueBefore - 1); // still seen after a reload
  await page
    .getByRole('button', { name: /Marcar como visto: Parcial de Bases/ })
    .first()
    .click(); // the other one
  await expect.poll(async () => (await oracle(page)).due.total).toBe(0);

  // E2E-13/20/21/22 — complete the recommended activity: every module moves together; reopen: back again.
  const before = await oracle(page);
  await setStatus(page, 'Lectura atrasada', 'Finalizada');
  const done = await oracle(page);
  expect(done.progress.general).toMatchObject({
    completed: 1,
    total: 8,
    pending: 7,
    overdue: 0,
    percentage: 13,
  });
  expect(radarCount(done.radar, 'overdue')).toBe(0);
  expect(attentionTitle(done.attention)).not.toBe('Lectura atrasada');
  expect(attentionTitle(done.attention)).toBe('Taller express');
  expect(done.dashboard.summary).toMatchObject({ completed: 1, overdue: 0 });
  expect(
    done.progress.subjects.find((x: { name: string }) => x.name === 'Bioestadística'),
  ).toMatchObject({ total: 2, completed: 1 });
  expect(
    done.progress.subjects.find((x: { name: string }) => x.name === 'Farmacología'),
  ).toMatchObject({ total: 0 });
  await page.goto('/dashboard');
  await expect(region(page, '¿Qué hago ahora?')).toContainText('Taller express');
  await expect(region(page, 'Progreso de actividades')).toContainText(
    '1 de 8 actividades finalizadas',
  );
  await page.goto('/progress');
  await expect(page.getByText('Sin actividades registradas').first()).toBeVisible(); // Farmacología
  expect(await flat(await page.locator('main').innerText())).not.toMatch(
    /estr[eé]s|sobrecarg|demasiad/i,
  );
  // The exam: completing it cancels its pending reminders; reopening revives them.
  await setStatus(page, 'Parcial de Bases', 'Finalizada');
  expect((await remindersOf(exam.id)).filter((r) => r.status === 'PENDING')).toEqual([]);
  await setStatus(page, 'Parcial de Bases', 'Pendiente');
  expect((await remindersOf(exam.id)).filter((r) => r.status === 'PENDING').length).toBeGreaterThan(
    0,
  );
  // Reopen the first one.
  await setStatus(page, 'Lectura atrasada', 'Pendiente');
  const reopened = await oracle(page);
  expect(reopened.progress.general).toEqual(before.progress.general);
  expect(reopened.radar.summary).toEqual(before.radar.summary);
  expect(attentionTitle(reopened.attention)).toBe('Lectura atrasada');
  expect(reopened.dashboard.summary).toEqual(before.dashboard.summary);
  await page.goto('/dashboard');
  await expect(region(page, '¿Qué hago ahora?')).toContainText('Lectura atrasada');

  // E2E-14 — persistence: reload, a brand-new browser context, logout and login.
  const snapshot = async (p: Page) => {
    const o = await oracle(p);
    return {
      summary: o.dashboard.summary,
      progress: o.progress.general,
      radar: o.radar.summary,
      attention: attentionTitle(o.attention),
      workload: o.workload.totals,
      titles: o.activities.map((a) => `${a.title}|${a.status}|${a.dueAt}`).sort(),
      subjects: o.progress.subjects.map((x: { name: string }) => x.name).sort(),
    };
  };
  const expected = await snapshot(page);
  await page.reload();
  expect(await snapshot(page)).toEqual(expected);

  const second = await browser.newContext();
  const page2 = await second.newPage();
  await page2.goto('/login');
  await login(page2, email);
  await expect(page2).toHaveURL(/\/dashboard$/);
  await expect(region(page2, '¿Qué hago ahora?')).toContainText('Lectura atrasada');
  expect(await snapshot(page2)).toEqual(expected);
  await second.close();

  const cookie = (await page.context().cookies()).find((c) =>
    /academic_planner_session/.test(c.name),
  )!;
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Lectura atrasada')).toHaveCount(0);
  expect(
    (
      await page.request.get('/api/activities', {
        headers: { Cookie: `${cookie.name}=${cookie.value}` },
      })
    ).status(),
  ).toBe(401);
  await login(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await snapshot(page)).toEqual(expected);

  // E2E-18 + accessibility on the populated screens (WCAG A/AA, axe).
  for (const route of ['/dashboard', '/activities', '/calendar', '/radar', '/progress']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations;
    expect(
      violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`),
      route,
    ).toEqual([]);
  }

  // Data integrity in the database after the whole story, and the story left no console errors behind.
  expect(await integrity(email)).toEqual({
    foreignSubject: 0,
    incoherentCompletion: 0,
    blockOutsidePeriod: 0,
    foreignReminder: 0,
    pendingOnCompleted: 0,
    currentPeriods: 1,
  });
  assertClean();

  // E2E-15 — the shell survives without a connection, shows no private data, and recovers.
  await page.goto('/dashboard');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('sin conexión');
  await expect(page.getByText('Lectura atrasada')).toHaveCount(0);
  await expect(page.getByText('Parcial de Bases')).toHaveCount(0);
  await page.context().setOffline(false);
  await page.reload();
  await expect(region(page, '¿Qué hago ahora?')).toContainText('Lectura atrasada');
});

/** The date (YYYY-MM-DD) of the first given weekday (1 = Monday) on or after the period start. */
function firstWeekday(weekday: number) {
  const d = new Date(`${bogotaToday(-70)}T12:00:00Z`);
  while (((d.getUTCDay() + 6) % 7) + 1 !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────── MULTIPLE STUDENTS ─────────────────────────

test('E2E-16: a second student starts from nothing and can not reach the first one’s data', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const aEmail = await newStudent(page);
  const subjects = await apiSubjects(page);
  const a = await apiCreateActivity(page, {
    subjectId: subjects[0]!.id,
    title: 'Secreto de Ana',
    type: 'EXAM',
    ...inBogota(2 * 86400e3),
  });
  await page.request.post('/api/schedule', {
    data: {
      type: 'CLASS',
      subjectId: subjects[0]!.id,
      title: 'Clase de Ana',
      date: firstWeekday(1),
      startTime: '08:00',
      endTime: '10:00',
      recurrence: { frequency: 'WEEKLY', until: bogotaToday(120) },
    },
  });
  const aBlock = (
    await (
      await page.request.get(`/api/schedule?from=${bogotaToday(-6)}&to=${bogotaToday(7)}`)
    ).json()
  ).occurrences[0].blockId as string;

  const other = await browser.newContext();
  const b = await other.newPage();
  await register(b, uniqueEmail(), 'Beto Gómez');
  await completeOnboarding(b, 'Semestre de Beto', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  for (const path of [
    '/dashboard',
    '/activities',
    '/subjects',
    '/calendar',
    '/radar',
    '/progress',
  ]) {
    await b.goto(path);
    await b.waitForLoadState('networkidle');
    const text = await b.locator('body').innerText();
    for (const secret of ['Secreto de Ana', 'Clase de Ana', 'Redes', aEmail])
      expect(text, `${path} leaks ${secret}`).not.toContain(secret);
  }
  // Direct attempts on Ana's resources behave exactly like missing ones.
  const ghost = '00000000-0000-4000-8000-000000000000';
  for (const [method, path] of [
    ['get', `/api/activities/${a.id}`],
    ['patch', `/api/activities/${a.id}`],
    ['delete', `/api/activities/${a.id}`],
    ['get', `/api/schedule/${aBlock}`],
    ['delete', `/api/schedule/${aBlock}`],
  ] as const) {
    const real = await b.request[method](
      path,
      method === 'patch' ? { data: { title: 'x' } } : undefined,
    );
    const missing = await b.request[method](
      path.replace(path.split('/').pop()!, ghost),
      method === 'patch' ? { data: { title: 'x' } } : undefined,
    );
    expect(real.status(), path).toBe(404);
    expect(await real.json(), path).toEqual(await missing.json());
  }
  const dash = (await (await b.request.get('/api/dashboard')).json()).dashboard;
  expect(dash.summary.total).toBe(0);
  // Ana still has everything.
  expect((await oracle(page)).activities.map((x) => x.title)).toContain('Secreto de Ana');
  await other.close();
});

// ───────────────────────── ERRORS AND RECOVERY ─────────────────────────

// Playwright's page.route() does not see requests made by a service worker, so the failure injection runs with
// the worker blocked (the offline / worker behaviour has its own coverage in pwa.spec and the master scenario).
test.describe('failures injected into the network', () => {
  test.use({ serviceWorkers: 'block' });

  test('E2E-17: a failed refresh keeps the data and "Reintentar" recovers; a failed create keeps the form', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await newStudent(page);
    const [redes] = await apiSubjects(page);
    await apiCreateActivity(page, {
      subjectId: redes!.id,
      title: 'Visible siempre',
      ...inBogota(3 * 86400e3),
    });
    await page.goto('/activities');
    await expect(page.getByText('Visible siempre')).toBeVisible();

    // The list refresh fails: the data stays, a quiet note appears, and Reintentar brings it back.
    await page.route(/\/api\/activities(\?.*)?$/, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":{"code":"INTERNAL_ERROR","message":"x"}}',
          })
        : route.continue(),
    );
    // The student leaves the tab and comes back: the browser says "hidden" and then "visible" again.
    await page.evaluate(() => {
      const set = (v: string) => {
        Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      };
      set('hidden');
      set('visible');
    });
    await expect(page.getByRole('status').filter({ hasText: 'No pudimos actualizar' })).toBeVisible(
      {
        timeout: 20_000,
      },
    ); // the app retries a failing request a few times first
    await expect(page.getByText('Visible siempre')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.unroute(/\/api\/activities(\?.*)?$/);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'No pudimos actualizar' })).toHaveCount(
      0,
    );

    // A create fails: nothing typed is lost; once the server answers, the same click saves it.
    await page.route(/\/api\/activities(\?.*)?$/, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":{"code":"INTERNAL_ERROR","message":"x"}}',
          })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Agregar actividad' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
    await dialog.getByLabel('Título').fill('No debe perderse');
    await dialog.getByLabel('Asignatura').selectOption({ label: 'Redes' });
    await dialog.getByLabel('Fecha').fill(bogotaToday(6));
    await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('Título')).toHaveValue('No debe perderse');
    await page.unroute(/\/api\/activities(\?.*)?$/);
    await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('No debe perderse')).toBeVisible();
  });

  test('E2E-17: when one proposal of the Inbox fails the others stay created and the failed one can be retried', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await newStudent(page);
    await page.goto('/inbox');
    await page
      .getByLabel('Mensaje del profesor o instrucción académica')
      .fill(
        'El jueves tendremos quiz de Bases de Datos a las 8 a. m. y el viernes deben entregar el taller de Bioestadística.',
      );
    await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
    await expect(page.getByRole('article')).toHaveCount(2);
    let posts = 0;
    await page.route(/\/api\/activities(\?.*)?$/, (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      return posts === 2
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":{"code":"INTERNAL_ERROR","message":"x"}}',
          })
        : route.continue();
    });
    await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '1 creada, 1 pendiente' }),
    ).toBeVisible();
    expect((await oracle(page)).activities).toHaveLength(1);
    await expect(page.getByRole('article').filter({ hasText: 'Actividad creada' })).toHaveCount(1);
    await page.unroute(/\/api\/activities(\?.*)?$/);
    await page.getByRole('button', { name: 'Crear seleccionadas' }).click();
    await expect(page.getByRole('article').filter({ hasText: 'Actividad creada' })).toHaveCount(2);
    expect((await oracle(page)).activities).toHaveLength(2);
  });

  test('E2E-17: when one class of the import fails the others stay and the failed one can be fixed and retried', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await newStudent(page);
    await page.goto('/calendar/import');
    await page
      .getByLabel('Archivo del horario (imagen PNG o JPG, o PDF)')
      .setInputFiles({ name: 'horario.png', mimeType: 'image/png', buffer: twoClassTable() });
    await page.getByRole('button', { name: 'Procesar horario' }).click();
    await expect(page.getByRole('article')).toHaveCount(2, { timeout: 30_000 });
    let posts = 0;
    await page.route('**/api/schedule', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      return posts === 2
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":{"code":"INTERNAL_ERROR","message":"x"}}',
          })
        : route.continue();
    });
    await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '1 clase importada, 1 necesita corrección' }),
    ).toBeVisible();
    await page.unroute('**/api/schedule');
    await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '1 clase importada, 0 necesitan corrección' }),
    ).toBeVisible();
    const occurrences = (
      await (
        await page.request.get(`/api/schedule?from=${bogotaToday(-6)}&to=${bogotaToday(7)}`)
      ).json()
    ).occurrences as { blockId: string }[];
    expect(new Set(occurrences.map((o) => o.blockId)).size).toBe(2); // two classes (each repeats weekly)
  });
});

// ───────────────────────── TIME ZONE, KEYBOARD, TABLET, ROUTES ─────────────────────────

test('E2E-18: a browser in Tokyo still lives in the student’s day (profile time zone)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  await newStudent(page);
  await page.goto('/dashboard');
  await page.getByLabel('Escribe la actividad en una frase').fill('tarea redes mañana');
  await page.getByRole('button', { name: 'Interpretar', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Vista previa de la actividad' }).getByLabel('Fecha'),
  ).toHaveValue(bogotaToday(1));
  await page.getByRole('button', { name: 'Crear actividad' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Actividad creada' })).toBeVisible();
  const dash = (await oracle(page)).dashboard;
  expect(dash.localDate).toBe(bogotaToday());
  await page.goto('/dashboard');
  await expect(page.getByText('Vence mañana').first()).toBeVisible();
  await page.goto('/calendar');
  const monday = new Date(`${bogotaToday()}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  await expect(page.getByText(`Semana del ${fmt(monday)}`)).toBeVisible();
  await context.close();
});

test('E2E-18: keyboard only, from the activity list to a completed activity', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile === true, 'a touch viewport is not driven by a keyboard');
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Semestre', { start: bogotaToday(-70), end: bogotaToday(120) });
  await addSubjectViaUi(page, 'Redes');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.getByLabel('Correo').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Actividades' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Agregar actividad' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });
  await page.keyboard.type('Entrega por teclado');
  await dialog.getByLabel('Asignatura').focus();
  await page.keyboard.press('ArrowDown');
  await dialog.getByLabel('Fecha').fill(bogotaToday(4));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  const select = page.getByLabel('Cambiar estado de Entrega por teclado');
  await select.focus();
  await page.keyboard.press('ArrowDown'); // Pendiente -> En proceso
  await expect(select).toHaveValue('IN_PROGRESS');
  await select.focus(); // the list re-renders after a change; the student tabs back to the control
  await page.keyboard.press('ArrowDown'); // -> Finalizada
  await expect(select).toHaveValue('COMPLETED');
  await expect
    .poll(
      async () =>
        (await oracle(page)).activities.find((a) => a.title === 'Entrega por teclado')?.status,
    )
    .toBe('COMPLETED');
});

test('E2E-18: tablet width (768 px) keeps the agreed layout on the main screens', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newStudent(page);
  const [redes] = await apiSubjects(page);
  await apiCreateActivity(page, {
    subjectId: redes!.id,
    title: 'Algo pendiente',
    ...inBogota(3 * 86400e3),
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const path of ['/dashboard', '/calendar', '/activities', '/inbox', '/calendar/import']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  }
  // Below 1024 px the Agenda is the day list (seven day buttons), not the weekly grid.
  await page.goto('/calendar');
  await expect(
    page.getByRole('button', { name: /^Lun / }).or(page.getByText(/^Lun$/)).first(),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
});

test('route inventory: every screen renders, survives a reload, and protected ones send visitors to the login', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const protectedRoutes = [
    '/dashboard',
    '/subjects',
    '/activities',
    '/calendar',
    '/calendar/import',
    '/radar',
    '/progress',
    '/inbox',
    '/onboarding',
  ];
  for (const path of protectedRoutes) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login$/);
  }
  for (const path of ['/login', '/register', '/status']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
  }
  await newStudent(page);
  const headings: Record<string, string> = {
    '/dashboard': 'Buen',
    '/subjects': 'Mis asignaturas',
    '/activities': 'Actividades',
    '/calendar': 'Agenda',
    '/calendar/import': 'Importar horario',
    '/radar': 'Radar académico',
    '/progress': 'Progreso y carga semanal',
    '/inbox': 'Bandeja académica',
  };
  for (const [path, heading] of Object.entries(headings)) {
    for (const how of ['goto', 'reload'] as const) {
      if (how === 'goto') await page.goto(path);
      else await page.reload();
      await expect(page, `${how} ${path}`).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`));
      await expect(page.getByRole('heading', { level: 1 }), `${how} ${path}`).toContainText(
        heading,
      );
    }
  }
  await page.goto('/login');
  await expect(page).toHaveURL(/\/dashboard$/); // a signed-in student does not see the login again
  await page.goto('/ruta/que-no-existe');
  await expect(
    page.getByRole('heading', { level: 1, name: 'No encontramos esa página' }),
  ).toBeVisible();
});

async function _unused(_b: Browser) {
  /* keeps the Browser type import used when a scenario above is skipped */
}
void _unused;
