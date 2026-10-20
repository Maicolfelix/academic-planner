import AxeBuilder from '@axe-core/playwright';
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

test.setTimeout(90_000);

const compact = (d: string) => d.replaceAll('-', '');
const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
/** The next Tuesday (at least tomorrow) as YYYY-MM-DD. */
const nextTuesday = () => {
  for (let i = 1; i <= 7; i++) if (weekdayOf(bogotaToday(i)) === 2) return bogotaToday(i);
  throw new Error('unreachable');
};

const ics = (events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Universidad//Calendario//ES',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const file = (name: string, text: string) => ({
  name,
  mimeType: 'text/calendar',
  buffer: Buffer.from(text, 'utf8'),
});
const picker = (page: Page) => page.getByLabel('Archivo de calendario (.ics)');
const results = (page: Page) => page.getByRole('region', { name: /eventos? en|Sin eventos/ });
const cardOf = (page: Page, title: string) =>
  page.getByRole('listitem').filter({
    has: page.getByRole('button', { name: `Quitar ${title} de la revisión` }),
  });

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const post = async (page: Page, path: string, data: object = {}) => {
  const res = await page.request.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};

const weeklyEvent = () => [
  'UID:clase-1@uni',
  'SUMMARY:Ciberseguridad',
  `DTSTART;TZID=America/Bogota:${compact(nextTuesday())}T070000`,
  `DTEND;TZID=America/Bogota:${compact(nextTuesday())}T090000`,
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
];

const calendarFile = () =>
  file(
    'calendario.ics',
    ics([
      weeklyEvent(),
      [
        'UID:parcial@uni',
        'SUMMARY:Parcial Ciberseguridad',
        `DTSTART;TZID=America/Bogota:${compact(bogotaToday(10))}T100000`,
        `DTEND;TZID=America/Bogota:${compact(bogotaToday(10))}T120000`,
      ],
      [
        'UID:entrega@uni',
        'SUMMARY:Entrega final Ciberseguridad',
        `DTSTART;VALUE=DATE:${compact(bogotaToday(14))}`,
        `DTEND;VALUE=DATE:${compact(bogotaToday(15))}`,
      ],
    ]),
  );

test('weekly class, exam and all-day delivery: read, review, ONE confirmation, then in the Agenda', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await addSubjectViaUi(page, 'Ciberseguridad');

  await page.goto('/calendar');
  await page.getByRole('link', { name: 'Importar calendario (.ics)' }).click();
  await expect(page).toHaveURL(/\/calendar\/import-ics$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Importar calendario' })).toBeVisible();

  let requests = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/ics-import/confirm')) requests++;
  });
  await picker(page).setInputFiles(calendarFile());
  await expect(page.getByText('calendario.ics')).toBeVisible();
  await page.getByRole('button', { name: 'Leer calendario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });

  // Reading created nothing.
  expect((await (await page.request.get('/api/activities')).json()).activities).toHaveLength(0);

  await expect(cardOf(page, 'Ciberseguridad').getByLabel('Tipo')).toHaveValue('BLOCK');
  await expect(cardOf(page, 'Parcial Ciberseguridad').getByLabel('Tipo')).toHaveValue('ACTIVITY');
  await expect(cardOf(page, 'Entrega final Ciberseguridad').getByLabel('Tipo')).toHaveValue(
    'ACTIVITY',
  );
  await expect(
    cardOf(page, 'Ciberseguridad').getByText(/Cada martes, 7:00 a\. m\. – 9:00 a\. m\./),
  ).toBeVisible();
  await expect(cardOf(page, 'Entrega final Ciberseguridad').getByText(/todo el día/)).toBeVisible();

  const confirm = page.getByRole('button', { name: 'Importar 2 actividades y 1 clase' });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status').filter({ hasText: '2 actividades creadas' })).toBeVisible();
  expect(requests).toBe(1);

  const acts = (await (await page.request.get('/api/activities')).json()).activities as {
    title: string;
    dueAt: string;
  }[];
  expect(acts.map((a) => a.title).sort()).toEqual([
    'Entrega final Ciberseguridad',
    'Parcial Ciberseguridad',
  ]);
  // The all-day delivery keeps its day (end of the local day, no UTC shift of the date).
  const entrega = acts.find((a) => a.title.startsWith('Entrega'))!;
  const local = new Date(new Date(entrega.dueAt).getTime() - 5 * 3600_000)
    .toISOString()
    .slice(0, 10);
  expect(local).toBe(bogotaToday(14));

  await page.goto('/calendar?week=' + nextTuesday());
  // The week view lists the class; on a phone the day picker marks Tuesday with one block.
  await expect(
    page
      .getByText('Ciberseguridad')
      .or(page.getByRole('button', { name: /^Martes \d+, 1 bloque/ }))
      .first(),
  ).toBeVisible();
  await assertClean();
});

test('layout holds at 360, 768 and 1366 and the review is accessible', async ({ page }) => {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await addSubjectViaUi(page, 'Ciberseguridad');
  await page.goto('/calendar/import-ics');
  await picker(page).setInputFiles(calendarFile());
  await page.getByRole('button', { name: 'Leer calendario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
    [],
  );
  // Keyboard: the kind select is reachable and changeable without a mouse.
  const kind = cardOf(page, 'Parcial Ciberseguridad').getByLabel('Tipo');
  await kind.focus();
  await kind.selectOption('SKIP');
  await expect(page.getByRole('button', { name: 'Importar 1 actividad y 1 clase' })).toBeVisible();
});

test('a file that is not a calendar is refused with a message and creates nothing', async ({
  page,
}) => {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await page.goto('/calendar/import-ics');
  await picker(page).setInputFiles(file('nota.ics', 'esto no es un calendario'));
  await page.getByRole('button', { name: 'Leer calendario' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get('/api/activities')).json()).activities).toHaveLength(0);
});

/** Two current studies, each with a subject called "Ciberseguridad", plus an unrelated "Cálculo". */
async function twoStudiesWithSameSubject(page: Page) {
  await register(page, uniqueEmail());
  await expect(page).toHaveURL(/\/onboarding$/);
  const ing = (await post(page, '/api/study-tracks', { name: 'Ingeniería', type: 'UNIVERSITY' }))
    .studyTrack;
  const dip = (await post(page, '/api/study-tracks', { name: 'Diplomado', type: 'OTHER_ACADEMIC' }))
    .studyTrack;
  const dates = { startDate: bogotaToday(-30), endDate: bogotaToday(90) };
  const pi = (await post(page, '/api/periods', { name: '2026-2', ...dates, studyTrackId: ing.id }))
    .period;
  const pd = (await post(page, '/api/periods', { name: 'Cohorte', ...dates, studyTrackId: dip.id }))
    .period;
  await post(page, '/api/subjects', { periodId: pi.id, name: 'Ciberseguridad' });
  await post(page, '/api/subjects', { periodId: pd.id, name: 'Ciberseguridad' });
  await post(page, '/api/subjects', { periodId: pi.id, name: 'Cálculo' });
}

test('two studies with the same subject name: the student chooses between exactly those two', async ({
  page,
}) => {
  await twoStudiesWithSameSubject(page);

  await page.goto('/calendar/import-ics');
  await picker(page).setInputFiles(file('clase.ics', ics([weeklyEvent()])));
  await page.getByRole('button', { name: 'Leer calendario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });

  const weekly = cardOf(page, 'Ciberseguridad');
  const subject = weekly.getByLabel('Asignatura');
  // Only the two candidates (plus the empty choice): never Cálculo, never a guess.
  await expect(subject.locator('option')).toHaveText([
    'Elige una asignatura',
    'Ciberseguridad · Ingeniería',
    'Ciberseguridad · Diplomado',
  ]);
  await expect(subject).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Nada que importar' })).toBeDisabled();

  await subject.selectOption({ label: 'Ciberseguridad · Diplomado' });
  await page.getByRole('button', { name: /^Importar/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 clase creada' })).toBeVisible();
  const week = await (
    await page.request.get(`/api/schedule?from=${nextTuesday()}&to=${nextTuesday()}`)
  ).json();
  expect(week.occurrences.map((o: { title: string }) => o.title)).toContain('Ciberseguridad');
});

const ensayo = () => [
  'UID:ensayo@uni',
  'SUMMARY:Entrega de ensayo',
  `DTSTART;TZID=America/Bogota:${compact(bogotaToday(12))}T180000`,
  `DTEND;TZID=America/Bogota:${compact(bogotaToday(12))}T190000`,
];

test('a ticked unresolved class blocks the ready activity too: one request, everything or nothing', async ({
  page,
}) => {
  await twoStudiesWithSameSubject(page);
  let requests = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/ics-import/confirm')) requests++;
  });
  await page.goto('/calendar/import-ics');
  await picker(page).setInputFiles(file('mixto.ics', ics([ensayo(), weeklyEvent()])));
  await page.getByRole('button', { name: 'Leer calendario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });

  // The activity is ready and ticked; the ambiguous class starts unticked, so the activity alone can go.
  await expect(page.getByRole('button', { name: 'Importar 1 actividad' })).toBeEnabled();
  // The student decides to import the class too, without choosing its subject yet.
  await page.getByRole('checkbox', { name: 'Importar Ciberseguridad' }).check();
  const blocked = page.getByRole('button', { name: 'Resolver antes de importar' });
  await expect(blocked).toBeDisabled();
  expect(requests).toBe(0);

  await cardOf(page, 'Ciberseguridad')
    .getByLabel('Asignatura')
    .selectOption({ label: 'Ciberseguridad · Diplomado' });
  await page.getByRole('button', { name: 'Importar 1 actividad y 1 clase' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 actividad creada y 1 clase creada' }),
  ).toBeVisible();
  expect(requests).toBe(1);
});

test('EXDATE undecided blocks everything; skipping the class lets the activity go alone', async ({
  page,
}) => {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  await addSubjectViaUi(page, 'Ciberseguridad');
  const second = new Date(`${nextTuesday()}T12:00:00Z`);
  second.setUTCDate(second.getUTCDate() + 7);
  const withExdate = [
    ...weeklyEvent(),
    `EXDATE;TZID=America/Bogota:${compact(second.toISOString().slice(0, 10))}T070000`,
  ];
  await page.goto('/calendar/import-ics');
  await picker(page).setInputFiles(file('exdate.ics', ics([ensayo(), withExdate])));
  await page.getByRole('button', { name: 'Leer calendario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('checkbox', { name: 'Importar Ciberseguridad' }).check();
  await expect(page.getByRole('button', { name: 'Resolver antes de importar' })).toBeDisabled();

  // Series or single resolves the class; skipping it releases the activity alone.
  const card = cardOf(page, 'Ciberseguridad');
  await card.getByLabel('Importar solo la primera clase, sin repetición').check();
  await expect(page.getByRole('button', { name: 'Importar 1 actividad y 1 clase' })).toBeEnabled();
  await card.getByLabel('No importar este evento').check();
  const only = page.getByRole('button', { name: 'Importar 1 actividad' });
  await expect(only).toBeEnabled();
  await only.click();
  await expect(page.getByRole('status').filter({ hasText: '1 actividad creada' })).toBeVisible();
  const week = await (
    await page.request.get(`/api/schedule?from=${nextTuesday()}&to=${nextTuesday()}`)
  ).json();
  expect(week.occurrences).toHaveLength(0);
});
