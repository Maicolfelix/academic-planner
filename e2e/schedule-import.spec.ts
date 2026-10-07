import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  buildTextPdf,
  drawTextImage,
  listItems,
  scannedTwoClassPdf,
  tableItems,
  twoClassTable,
  weeklyCalendarImage,
} from '../apps/api/test/scheduleImportFixtures';
import {
  addSubjectViaUi,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });

async function newUser(page: Page, subjects: string[]) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', period());
  for (const name of subjects) await addSubjectViaUi(page, name);
}

const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });
const picker = (page: Page) => page.getByLabel('Archivo del horario (imagen PNG o JPG, o PDF)');
const results = (page: Page) =>
  page.getByRole('region', { name: /clases? detectadas?|Sin clases/ });
const cards = (page: Page) => page.getByRole('article');
const card = (page: Page, n: number) => cards(page).nth(n);

async function readFile(page: Page, f: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/calendar/import');
  await picker(page).setInputFiles(f);
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });
}

const blocks = async (page: Page) =>
  (
    await (
      await page.request.get('/api/schedule?from=' + bogotaToday(0) + '&to=' + bogotaToday(6))
    ).json()
  ).occurrences as { title: string }[];
const blockCount = async (page: Page) => (await blocks(page)).length;

const PNG = () => file('horario.png', 'image/png', twoClassTable());

test('image -> read -> review -> correct -> import, then the same file warns about duplicates', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Redes', 'Bases de Datos']);

  // Entry point is in the Agenda, not in the main navigation.
  await page.goto('/calendar');
  await expect(
    page.getByRole('navigation', { name: 'Principal' }).getByText('Importar horario'),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Importar horario' }).click();
  await expect(page).toHaveURL(/\/calendar\/import$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Importar horario' })).toBeVisible();

  await picker(page).setInputFiles(PNG());
  await expect(page.getByText('Archivo elegido: horario.png')).toBeVisible();
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(results(page)).toBeVisible({ timeout: 30_000 });
  await expect(results(page)).toBeFocused();
  await expect(page.getByRole('heading', { level: 2, name: '2 clases detectadas' })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  // Nothing was created by reading.
  expect(await blockCount(page)).toBe(0);

  // Proposal 1: Redes, Monday 08:00-10:00. Proposal 2: Bases de Datos, Wednesday 10:00-12:00.
  const redes = card(page, 0);
  const bases = card(page, 1);
  await expect(redes.getByLabel('Asignatura', { exact: true })).toContainText('Redes');
  await expect(redes.getByLabel('Día')).toHaveValue('1');
  await expect(redes.getByLabel('Inicio', { exact: true })).toHaveValue('08:00');
  await expect(redes.getByLabel('Fin', { exact: true })).toHaveValue('10:00');
  await expect(redes.getByLabel('Título')).toHaveValue('Redes');
  await expect(redes).toContainText('Texto leído');
  await expect(bases.getByLabel('Día')).toHaveValue('3');
  await expect(bases.getByLabel('Inicio', { exact: true })).toHaveValue('10:00');
  await expect(bases.getByLabel('Fin', { exact: true })).toHaveValue('12:00');
  await expect(bases.getByLabel('Título')).toHaveValue('Bases de Datos');
  await expectNoHorizontalOverflow(page);

  // Correct one hour, drop the other class, import.
  await bases.getByLabel('Fin', { exact: true }).fill('13:00');
  await redes.getByLabel(/Incluir/).uncheck();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 clase importada.' })).toBeVisible();
  await expect(bases).toContainText('Clase importada');
  await expect(bases).toContainText('10:00–13:00');
  await expect(redes.getByLabel(/Incluir/)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Importar seleccionadas' })).toBeDisabled();

  // The class is in the agenda, weekly: its Wednesday shows up in any week.
  expect((await blocks(page)).map((b) => b.title)).toEqual(['Bases de Datos']);

  // Then the other one, unchanged.
  await redes.getByLabel(/Incluir/).check();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(redes).toContainText('Clase importada');
  expect((await blocks(page)).map((b) => b.title).sort()).toEqual(['Bases de Datos', 'Redes']);

  // Same file again: Redes is already there (duplicate); Bases was changed to 10:00-13:00, so the new reading
  // of 10:00-12:00 is NOT a duplicate but it does overlap it (a conflict). The two ideas stay separate.
  await readFile(page, PNG());
  await expect(card(page, 0)).toContainText('Esta clase parece estar ya en tu agenda.');
  await expect(card(page, 0).getByLabel(/Incluir/)).not.toBeChecked(); // a duplicate is the student's call
  await expect(card(page, 1)).not.toContainText('Esta clase parece estar ya en tu agenda.');
  await expect(card(page, 1)).toContainText(
    /Conflicto con Bases de Datos, miércoles 10:00\sa\.\sm\.–1:00\sp\.\sm\./,
  );
  await expect(card(page, 1).getByLabel(/Incluir/)).toBeChecked(); // a conflict warns, it does not unselect
  assertClean();
});

test('a PDF with text, and a scanned PDF, give the same classes', async ({ page }) => {
  await newUser(page, ['Redes', 'Bases de Datos']);

  const text = buildTextPdf(
    listItems(['Lunes', '08:00 - 10:00 Redes', 'Miércoles', '10:00 - 12:00 Bases de Datos']),
  );
  await readFile(page, file('horario.pdf', 'application/pdf', text));
  await expect(page.getByText('Leído del texto del PDF.')).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, 0).getByLabel('Día')).toHaveValue('1');
  await expect(card(page, 1).getByLabel('Inicio', { exact: true })).toHaveValue('10:00');

  await readFile(page, file('escaneado.pdf', 'application/pdf', scannedTwoClassPdf()));
  await expect(page.getByText(/PDF escaneado con reconocimiento de texto/)).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, 1).getByLabel('Asignatura', { exact: true })).toContainText(
    'Bases de Datos',
  );
});

test('an invalid file is explained, not a technical error', async ({ page }) => {
  // (the browser logs the expected 415 as a console error, so this test checks the screen, not the console)
  await newUser(page, ['Redes']);
  await page.goto('/calendar/import');

  // Not an image, whatever its name says.
  await picker(page).setInputFiles(
    file('horario.png', 'image/png', Buffer.from('Lunes 08:00 Redes')),
  );
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('alert')).toContainText('Formato no compatible');
  await expect(page.getByRole('alert')).toBeFocused();

  // Wrong type, caught before uploading.
  await picker(page).setInputFiles(file('notas.txt', 'text/plain', Buffer.from('hola')));
  await expect(page.getByRole('alert')).toContainText('Formato no compatible');
  await expect(page.getByText('Archivo elegido')).toHaveCount(0);

  // Too big, caught before uploading.
  await picker(page).setInputFiles(file('enorme.png', 'image/png', Buffer.alloc(11 * 1024 * 1024)));
  await expect(page.getByRole('alert')).toContainText('El archivo es demasiado grande.');

  // No file at all.
  await page.reload();
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('alert')).toContainText('Selecciona un archivo');
});

test('nothing readable: an honest message and a way out', async ({ page }) => {
  await newUser(page, ['Redes']);
  await readFile(page, file('vacio.png', 'image/png', drawTextImage([])));
  await expect(
    page.getByRole('heading', { level: 2, name: 'Sin clases detectadas' }),
  ).toBeVisible();
  await expect(page.getByText('No pudimos leer suficiente información del horario.')).toBeVisible();
  await expect(
    page.getByText('La imagen puede estar borrosa o tener poca resolución.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ingresar horario manualmente' })).toBeVisible();
  await page.getByRole('button', { name: 'Probar otra imagen' }).click();
  await expect(picker(page)).toBeVisible();
});

test('a doubtful subject asks, an unknown one is proposed as NEW, an incomplete class waits for its end time', async ({
  page,
}) => {
  await newUser(page, ['Programación I', 'Programación II', 'Redes de Computadores']);
  const items = listItems([
    'Lunes',
    '08:00 - 10:00 Programación',
    '10:00 - 12:00 Quimica',
    'Martes',
    '08:00 Redes',
  ]);
  await readFile(
    page,
    file('horario.png', 'image/png', drawTextImage(items, { width: 800, height: 380 })),
  );
  await expect(cards(page)).toHaveCount(3);

  // 1. Two similar subjects: the student chooses (no default); it cannot be included until they do.
  const ambiguous = card(page, 0);
  await expect(ambiguous.getByRole('group', { name: '¿A cuál te refieres?' })).toBeVisible();
  await expect(ambiguous.getByLabel('Asignatura', { exact: true })).toHaveValue('');
  await expect(ambiguous).toContainText('Revisar');
  await expect(ambiguous.getByLabel(/Incluir/)).toBeDisabled();
  await ambiguous.getByLabel('Programación II').check();
  await expect(ambiguous.getByLabel('Asignatura', { exact: true })).toContainText(
    'Programación II',
  );
  await expect(ambiguous).toContainText('Existente');

  // 2. Unknown subject: proposed as NEW, already selected: nothing to decide. It stays a choice among the student's
  // own subjects if they prefer.
  const unknown = card(page, 1);
  await expect(unknown).toContainText('Nueva — se creará al importar');
  await expect(unknown).not.toContainText('Asignatura sin reconocer');
  await expect(nameInput(unknown)).toHaveValue('Quimica');
  await expect(unknown.getByLabel('Título')).toHaveValue('Quimica');
  await expect(unknown.getByLabel(/Incluir/)).toBeChecked();
  await expect(importButton(page)).toBeEnabled(); // the NEW class alone is enough to import
  await unknown.getByLabel('Asignatura', { exact: true }).selectOption({ label: 'Programación I' });
  await expect(unknown).toContainText('Existente');
  await expect(unknown.getByLabel('Título')).toHaveValue('Programación I');

  // 3. Only a start time and a similar name: suggestion + missing end time.
  const partial = card(page, 2);
  await expect(partial).toContainText('¿Quisiste decir Redes de Computadores?');
  await expect(partial).toContainText('Para importarla falta la asignatura, la hora de fin');
  await partial.getByRole('button', { name: 'Sí, es Redes de Computadores' }).click();
  await expect(partial.getByLabel('Asignatura', { exact: true })).toContainText(
    'Redes de Computadores',
  );
  await expect(partial.getByLabel(/Incluir/)).toBeDisabled(); // still no end time
  await partial.getByLabel('Fin', { exact: true }).fill('07:00');
  await expect(partial).toContainText('La hora de fin debe ser posterior');
  await partial.getByLabel('Fin', { exact: true }).fill('09:00');
  await expect(partial.getByLabel(/Incluir/)).toBeEnabled();

  // Now all three are complete: select them all and import.
  await page.getByRole('button', { name: 'Seleccionar todas', exact: true }).click();
  await expect(importButton(page)).toBeEnabled();
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '3 clases importadas.' })).toBeVisible();
});

test('"No, crear una asignatura nueva" turns a suggestion into a NEW subject', async ({ page }) => {
  await newUser(page, ['Redes de Computadores']);
  const items = listItems(['Martes', '08:00 - 09:00 Redes']);
  await readFile(
    page,
    file('h.png', 'image/png', drawTextImage(items, { width: 800, height: 200 })),
  );
  const c = card(page, 0);
  await expect(c).toContainText('¿Quisiste decir Redes de Computadores?');
  await expect(include(c)).toBeDisabled(); // undecided
  await c.getByRole('button', { name: 'No, crear una asignatura nueva' }).click();
  await expect(c).toContainText('Nueva — se creará al importar');
  await expect(nameInput(c)).toHaveValue('Redes');
  await include(c).check();
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '1 clase importada.' })).toBeVisible();
  expect(await subjectNames(page)).toEqual(['Redes', 'Redes de Computadores']);
});

test('a class that overlaps another is a warning, not a block', async ({ page }) => {
  await newUser(page, ['Redes', 'Bases de Datos']);
  await readFile(page, PNG());
  await card(page, 0)
    .getByLabel(/Incluir/)
    .check();
  await card(page, 1)
    .getByLabel(/Incluir/)
    .uncheck();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(card(page, 0)).toContainText('Clase importada');

  // Bases de Datos moved to overlap Redes (Mon 08-10): the conflict shows while editing.
  await card(page, 1).getByLabel('Día').selectOption('1');
  await card(page, 1).getByLabel('Inicio', { exact: true }).fill('09:00');
  await card(page, 1).getByLabel('Fin', { exact: true }).fill('11:00');
  await expect(card(page, 1)).toContainText(/Conflicto con Redes, lunes 8:00–10:00\sa\.\sm\./);
  await card(page, 1)
    .getByLabel(/Incluir/)
    .check();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(card(page, 1)).toContainText('Clase importada'); // it did not block
});

// ───────────────────────── A1: missing subjects are proposed and created on confirmation ─────────────────────────

const NEW_BADGE = 'Nueva — se creará al importar';
const nameInput = (c: Locator) => c.getByLabel('Nombre de la asignatura nueva', { exact: true });
const subjectSelect = (c: Locator) => c.getByLabel('Asignatura', { exact: true });
const include = (c: Locator) => c.getByLabel(/Incluir/);
const importButton = (page: Page) => page.getByRole('button', { name: 'Importar seleccionadas' });
const CALENDAR = () => file('calendario.png', 'image/png', weeklyCalendarImage());

/** The agenda of the next 7 days (a weekly series shows up once per weekday), as [title, start, end] in Bogotá time. */
const agenda = async (page: Page) => {
  const res = await page.request.get(
    '/api/schedule?from=' + bogotaToday(0) + '&to=' + bogotaToday(6),
  );
  const at = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
    });
  return ((await res.json()).occurrences as { title: string; startAt: string; endAt: string }[])
    .map((o) => [o.title, at(o.startAt), at(o.endAt)])
    .sort((a, b) => a.join('|').localeCompare(b.join('|')));
};
const subjectNames = async (page: Page) =>
  (await apiSubjects(page)).map((s) => s.name).sort((a, b) => a.localeCompare(b));

test('A1: a student with no subjects imports a real calendar: subjects are proposed, named, created and scheduled', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertClean = watch(page);
  await newUser(page, []);
  await readFile(page, CALENDAR());
  await expect(cards(page)).toHaveCount(2);
  const [proyectos, practicas] = [card(page, 0), card(page, 1)];

  // Reading proposes; both subjects are NEW and nothing blocks them. Nothing exists yet.
  for (const c of [proyectos, practicas]) {
    await expect(c).toContainText('Se creará al importar.');
    await expect(c).not.toContainText('Asignatura sin reconocer');
  }
  await expect(proyectos).toContainText(NEW_BADGE);
  // The second one was read with low confidence (OCR): it says NEW, but also that the name needs a look, next to
  // the name itself, and it does not start selected.
  await expect(practicas).toContainText('Nueva — revisa el nombre');
  await expect(practicas).toContainText('Se leyó con poca claridad');
  await expect(practicas).not.toContainText(NEW_BADGE);
  await expect(proyectos.getByLabel('Día')).toHaveValue('3');
  await expect(proyectos.getByLabel('Inicio', { exact: true })).toHaveValue('19:00');
  await expect(proyectos.getByLabel('Fin', { exact: true })).toHaveValue('20:30');
  await expect(practicas.getByLabel('Día')).toHaveValue('6');
  await expect(practicas.getByLabel('Inicio', { exact: true })).toHaveValue('14:00');
  await expect(practicas.getByLabel('Fin', { exact: true })).toHaveValue('16:15');
  await expect(nameInput(proyectos)).toHaveValue('Proyectos II REMOTO Proyecto'); // the code "ZISXA-" is gone
  await expect(include(proyectos)).toBeChecked(); // a clean NEW subject starts selected: confirming is enough
  expect(await apiSubjects(page)).toEqual([]);
  expect(await agenda(page)).toEqual([]);
  await expectNoHorizontalOverflow(page);
  const violations = (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(violations, 'axe on the NEW-subject preview').toEqual([]);

  // Review: the names the reading left too long are corrected; the second card was read with low confidence,
  // so it starts unselected and the student looks at it.
  await nameInput(proyectos).fill('Proyectos II');
  await expect(proyectos.getByLabel('Título')).toHaveValue('Proyectos II'); // the title follows the name
  await nameInput(practicas).fill('Prácticas Empresariales');
  await expect(include(practicas)).not.toBeChecked();
  await include(practicas).check();
  await expect(
    page.getByText(
      'Al importar se crearán 2 asignaturas nuevas: Proyectos II, Prácticas Empresariales.',
    ),
  ).toBeVisible();

  await importButton(page).click();
  const status = page.getByRole('status').filter({ hasText: '2 clases importadas.' });
  await expect(status).toBeVisible();
  await expect(status).toContainText(
    'Se crearon las asignaturas Proyectos II, Prácticas Empresariales.',
  );
  await expect(proyectos).toContainText('Clase importada');

  expect(await subjectNames(page)).toEqual(['Prácticas Empresariales', 'Proyectos II']);
  expect(await agenda(page)).toEqual(
    [
      ['Proyectos II', '19:00', '20:30'],
      ['Prácticas Empresariales', '14:00', '16:15'],
    ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
  );

  await page.goto('/subjects');
  await expect(page.getByText('Proyectos II', { exact: true })).toBeVisible();
  await expect(page.getByText('Prácticas Empresariales', { exact: true })).toBeVisible();
  assertClean();
});

test('A1: an existing subject is reused, not duplicated; only the missing one is created', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newUser(page, ['Proyectos II']);
  await readFile(page, CALENDAR());
  const [proyectos, practicas] = [card(page, 0), card(page, 1)];

  await expect(proyectos).toContainText('Existente');
  await expect(proyectos).not.toContainText(NEW_BADGE);
  await expect(subjectSelect(proyectos)).toContainText('Proyectos II');
  await expect(nameInput(proyectos)).toHaveCount(0); // an existing subject needs no name
  await expect(practicas).toContainText('Nueva — revisa el nombre');

  await nameInput(practicas).fill('Prácticas Empresariales');
  await include(practicas).check();
  await expect(
    page.getByText('Al importar se creará una asignatura nueva: Prácticas Empresariales.'),
  ).toBeVisible();
  await importButton(page).click();
  const status = page.getByRole('status').filter({ hasText: '2 clases importadas.' });
  await expect(status).toContainText('Se creó la asignatura Prácticas Empresariales.');

  expect(await subjectNames(page)).toEqual(['Prácticas Empresariales', 'Proyectos II']); // one Proyectos II
});

test('A1: the name of a new subject can be corrected; a name that already exists reuses that subject', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newUser(page, ['Redes']);
  const items = listItems(['Lunes', '08:00 - 10:00 Quimica']);
  await readFile(
    page,
    file('h.png', 'image/png', drawTextImage(items, { width: 800, height: 200 })),
  );
  const c = card(page, 0);
  await expect(nameInput(c)).toHaveValue('Quimica');

  // Typing the name of a subject that already exists says so, and creates nothing.
  await nameInput(c).fill('  redes ');
  await expect(c).toContainText('Existente');
  await expect(c).toContainText('Ya tienes «Redes»: se usará esa asignatura.');
  await expect(page.getByText(/Al importar se crear/)).toHaveCount(0);

  // A different name is NEW again, and the class takes it as its title.
  await nameInput(c).fill('Química');
  await expect(c).toContainText(NEW_BADGE);
  await expect(c.getByLabel('Título')).toHaveValue('Química');
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '1 clase importada.' })).toBeVisible();
  expect(await subjectNames(page)).toEqual(['Química', 'Redes']);
  expect(await agenda(page)).toEqual([['Química', '08:00', '10:00']]);
});

test('A1: several classes of the same new subject create ONE subject', async ({ page }) => {
  await newUser(page, []);
  const items = listItems([
    'Lunes',
    '08:00 - 10:00 Redes de Computadores',
    'Miércoles',
    '10:00 - 12:00 Redes de Computadores',
  ]);
  await readFile(
    page,
    file('h.png', 'image/png', drawTextImage(items, { width: 800, height: 320 })),
  );
  await expect(cards(page)).toHaveCount(2);
  await expect(
    page.getByText('Al importar se creará una asignatura nueva: Redes de Computadores.'),
  ).toBeVisible();
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '2 clases importadas.' })).toBeVisible();
  expect(await subjectNames(page)).toEqual(['Redes de Computadores']);
  expect(await agenda(page)).toEqual([
    ['Redes de Computadores', '08:00', '10:00'],
    ['Redes de Computadores', '10:00', '12:00'],
  ]);
});

const TWO_CODES = () =>
  file(
    'h.png',
    'image/png',
    drawTextImage(
      listItems(['Lunes', '08:00 - 10:00 ABCDE-Redes', 'Miércoles', '10:00 - 12:00 FGHIJ-Redes']),
      { width: 800, height: 320 },
    ),
  );
const includeAll = async (cs: Locator[]) => {
  for (const c of cs) if (!(await include(c).isChecked())) await include(c).check();
};

test('A1: two codes that clean to the same name are not merged silently: the student says "same subject"', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newUser(page, []);
  await readFile(page, TWO_CODES());
  await expect(cards(page)).toHaveCount(2);
  const [first, second] = [card(page, 0), card(page, 1)];

  // Both would become "Redes": the preview asks instead of presenting them as settled NEW subjects.
  for (const c of [first, second]) {
    await expect(nameInput(c)).toHaveValue('Redes');
    await expect(c).toContainText('vienen de códigos diferentes');
    await expect(c).toContainText('Revisa si pertenecen a la misma asignatura');
    await expect(c).not.toContainText(NEW_BADGE);
    await expect(c.getByText('Revisar', { exact: true })).toBeVisible();
    await expect(include(c)).toBeDisabled();
    await expect(include(c)).not.toBeChecked();
    await expect(c).toContainText('falta decidir si es la misma asignatura');
  }
  await expect(importButton(page)).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  const violations = (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(violations, 'axe on the conflicting-codes preview').toEqual([]);
  expect(await apiSubjects(page)).toEqual([]);

  // "Sí, es la misma asignatura": one subject, both classes.
  await first.getByRole('button', { name: 'Sí, es la misma asignatura' }).click();
  for (const c of [first, second]) {
    await expect(c).not.toContainText('vienen de códigos diferentes');
    await expect(c).toContainText('Nueva');
  }
  await includeAll([first, second]);
  await expect(page.getByText('Al importar se creará una asignatura nueva: Redes.')).toBeVisible();
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '2 clases importadas.' })).toBeVisible();
  expect(await subjectNames(page)).toEqual(['Redes']);
  // both classes are in the agenda, attached to that one subject (the hours are not the point of this test)
  expect((await agenda(page)).map((o) => o[0])).toEqual(['Redes', 'Redes']);
});

test('A1: two codes that clean to the same name: naming them differently makes two subjects', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newUser(page, []);
  await readFile(page, TWO_CODES());
  const [first, second] = [card(page, 0), card(page, 1)];
  await expect(first).toContainText('vienen de códigos diferentes');

  await nameInput(first).fill('Redes A');
  await expect(first).not.toContainText('vienen de códigos diferentes'); // the group no longer shares a name
  await expect(second).not.toContainText('vienen de códigos diferentes');
  await nameInput(second).fill('Redes B');
  await includeAll([first, second]);
  await expect(
    page.getByText('Al importar se crearán 2 asignaturas nuevas: Redes A, Redes B.'),
  ).toBeVisible();
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '2 clases importadas.' })).toBeVisible();
  expect(await subjectNames(page)).toEqual(['Redes A', 'Redes B']);
});

test('A1: leaving the preview creates nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await newUser(page, []);
  await readFile(page, CALENDAR());
  await expect(cards(page)).toHaveCount(2);
  await nameInput(card(page, 0)).fill('Proyectos II');
  await page.getByRole('button', { name: 'Subir otro archivo' }).click();
  await expect(picker(page)).toBeVisible();
  expect(await apiSubjects(page)).toEqual([]);
  expect(await agenda(page)).toEqual([]);

  await readFile(page, CALENDAR());
  await page.getByRole('link', { name: 'Volver a la Agenda' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  expect(await apiSubjects(page)).toEqual([]);
  expect(await agenda(page)).toEqual([]);
});

test('A1: an invalid name blocks the class with an accessible error, and nothing is saved', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newUser(page, []);
  await readFile(page, CALENDAR());
  const c = card(page, 0);
  const input = nameInput(c);

  await input.fill('   ');
  await expect(c.getByText('Ingresa un nombre.')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await input.getAttribute('aria-describedby');
  expect(describedBy).toContain('-error');
  await expect(
    page.locator(`#${describedBy!.split(' ').find((d) => d.endsWith('-error'))}`),
  ).toHaveText('Ingresa un nombre.');
  await expect(c).toContainText('Para importarla falta el nombre de la asignatura.');
  await expect(include(c)).toBeDisabled();
  await expect(include(c)).not.toBeChecked();
  await expect(importButton(page)).toBeDisabled();

  await input.fill('x'.repeat(101));
  await expect(c.getByText(/El nombre es demasiado largo/)).toBeVisible();
  await expect(importButton(page)).toBeDisabled();

  await input.fill('Proyectos II');
  await expect(c.getByText('Ingresa un nombre.')).toHaveCount(0);
  await expect(include(c)).toBeEnabled();
  await include(c).check();
  await expect(importButton(page)).toBeEnabled();

  expect(await apiSubjects(page)).toEqual([]);
  expect(await agenda(page)).toEqual([]);
});

test('A1: all or nothing: a class the server refuses saves nothing and says which one and why', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertClean = watch(page, ['409 /api/schedule-import/confirm']);
  await newUser(page, []);
  await readFile(page, CALENDAR());
  await nameInput(card(page, 0)).fill('Proyectos II');
  await nameInput(card(page, 1)).fill('Prácticas Empresariales');
  await include(card(page, 1)).check();
  await importButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: '2 clases importadas.' })).toBeVisible();

  // The same file again: both classes are already in the agenda. The student insists on one of them.
  await page.getByRole('button', { name: 'Subir otro archivo' }).click();
  await picker(page).setInputFiles(CALENDAR());
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(cards(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(card(page, 0)).toContainText('Esta clase parece estar ya en tu agenda.');
  await expect(card(page, 0)).toContainText('Existente');
  await include(card(page, 0)).check();
  await importButton(page).click();

  const alert = page.getByRole('alert').filter({ hasText: 'ya están en tu agenda' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('no se importó nada');
  await expect(alert).toBeFocused();
  await expect(card(page, 0)).toContainText('Esta clase ya está en tu agenda.');
  await expect(card(page, 0)).not.toContainText('Clase importada');
  expect(await subjectNames(page)).toEqual(['Prácticas Empresariales', 'Proyectos II']);
  expect(await agenda(page)).toHaveLength(2);
  assertClean();
});

for (const hostile of [
  '<img src=x onerror="window.__xss=1">Quimica',
  '<script>window.__xss=1</script>Quimica',
]) {
  test(`A1: a hostile subject name is shown as plain text, never as markup (${hostile.slice(0, 8)}…)`, async ({
    page,
  }) => {
    await newUser(page, []);
    const items = listItems(['Lunes', '08:00 - 10:00 Quimica']);
    await readFile(
      page,
      file('h.png', 'image/png', drawTextImage(items, { width: 800, height: 200 })),
    );
    await nameInput(card(page, 0)).fill(hostile);
    await expect(card(page, 0).getByLabel('Título')).toHaveValue(hostile);
    await importButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: '1 clase importada.' })).toBeVisible();
    await expect(card(page, 0)).toContainText(hostile); // as text

    await page.goto('/subjects');
    await expect(page.getByText(hostile)).toBeVisible();
    await expect(page.locator('img[src="x"], main script')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
  });
}

test('offline: a clear message, nothing pretends to work, and it recovers', async ({ page }) => {
  await newUser(page, ['Redes', 'Bases de Datos']);
  await page.goto('/calendar/import');
  await picker(page).setInputFiles(PNG());
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('alert')).toContainText('necesita conexión');
  await expect(cards(page)).toHaveCount(0);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(cards(page)).toHaveCount(2, { timeout: 30_000 });
});

test('the uploaded file and the reading are never kept in Cache Storage', async ({ page }) => {
  await newUser(page, ['Redes', 'Bases de Datos']);
  await page.goto('/calendar/import');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await picker(page).setInputFiles(PNG());
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(cards(page)).toHaveCount(2, { timeout: 30_000 });
  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    return out;
  });
  expect(urls.filter((u) => u.startsWith('/api/'))).toEqual([]);
});

test('phone: the review is a vertical list with comfortable controls', async ({ page }) => {
  await newUser(page, ['Redes', 'Bases de Datos']);
  await readFile(page, PNG());
  await expectNoHorizontalOverflow(page);
  const heights = await page
    .getByRole('button', { name: /Importar seleccionadas|Seleccionar todas|Subir otro archivo/ })
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  const boxes = await cards(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  // Cards stack (the second starts below the first) and fit the viewport width.
  expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.bottom - 1);
  const viewport = page.viewportSize()!.width;
  for (const b of boxes) expect(b.right).toBeLessThanOrEqual(viewport + 1);
});

test('tabular input with room lines and merged hours is read like the table it is', async ({
  page,
}) => {
  await newUser(page, ['Redes', 'Bases de Datos']);
  const items = tableItems([
    { time: '08:00', cells: [{ day: 0, text: 'Redes' }] },
    { time: '09:00', cells: [{ day: 0, text: 'Redes' }] },
    { time: '10:00', cells: [{ day: 2, text: 'Bases de Datos' }] },
    { time: '11:00', cells: [] },
  ]);
  await readFile(
    page,
    file('tabla.png', 'image/png', drawTextImage(items, { width: 900, height: 520 })),
  );
  await expect(card(page, 0).getByLabel('Inicio', { exact: true })).toHaveValue('08:00');
  await expect(card(page, 0).getByLabel('Fin', { exact: true })).toHaveValue('10:00');
  await expect(card(page, 1).getByLabel('Día')).toHaveValue('3');
});

test('a visual calendar with compact ranges and an hour axis: two real classes, no card made of the axis', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page, ['Proyectos II', 'Prácticas Empresariales']);
  await readFile(page, file('calendario.png', 'image/png', weeklyCalendarImage()));

  // Exactly two classes (before the fix the axis labels made a third one and spoiled the hours).
  await expect(page.getByRole('heading', { level: 2, name: '2 clases detectadas' })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  const proyectos = card(page, 0);
  const practicas = card(page, 1);
  await expect(proyectos.getByLabel('Día')).toHaveValue('3'); // Wednesday
  await expect(proyectos.getByLabel('Inicio', { exact: true })).toHaveValue('19:00');
  await expect(proyectos.getByLabel('Fin', { exact: true })).toHaveValue('20:30');
  await expect(proyectos.getByLabel('Título')).toHaveValue('Proyectos II');
  await expect(practicas.getByLabel('Día')).toHaveValue('6'); // Saturday
  await expect(practicas.getByLabel('Inicio', { exact: true })).toHaveValue('14:00');
  await expect(practicas.getByLabel('Fin', { exact: true })).toHaveValue('16:15');
  await expect(practicas.getByLabel('Título')).toHaveValue('Prácticas Empresariales');
  await expectNoHorizontalOverflow(page);

  // Reading only proposes.
  expect(await blockCount(page)).toBe(0);

  // Confirming creates the two weekly classes with those hours.
  for (const c of [proyectos, practicas]) await c.getByLabel(/Incluir/).check();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 clases importadas.' })).toBeVisible();
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
    });
  const week = (
    await (
      await page.request.get('/api/schedule?from=' + bogotaToday(0) + '&to=' + bogotaToday(6))
    ).json()
  ).occurrences as { title: string; startAt: string; endAt: string }[];
  expect(
    week
      .map((o) => [o.title, clock(o.startAt), clock(o.endAt)])
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
  ).toEqual([
    ['Prácticas Empresariales', '14:00', '16:15'],
    ['Proyectos II', '19:00', '20:30'],
  ]);

  // The same picture again: both classes are already in the agenda.
  await readFile(page, file('calendario.png', 'image/png', weeklyCalendarImage()));
  await expect(cards(page)).toHaveCount(2);
  for (const n of [0, 1])
    await expect(card(page, n)).toContainText('Esta clase parece estar ya en tu agenda.');
  assertClean();
});
