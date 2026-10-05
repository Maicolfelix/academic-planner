import { expect, test, type Page } from '@playwright/test';
import {
  buildTextPdf,
  drawTextImage,
  listItems,
  scannedTwoClassPdf,
  tableItems,
  twoClassTable,
} from '../apps/api/test/scheduleImportFixtures';
import {
  addSubjectViaUi,
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
  await expect(redes.getByLabel('Asignatura')).toContainText('Redes');
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
  await expect(
    page.getByRole('status').filter({ hasText: '1 clase importada, 0 necesitan corrección' }),
  ).toBeVisible();
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
  await expect(card(page, 1)).toContainText(/Conflicto con Bases de Datos, miércoles 10:00–13:00/);
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
  await expect(card(page, 1).getByLabel('Asignatura')).toContainText('Bases de Datos');
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

test('ambiguous, unknown and incomplete classes need the student before they can be imported', async ({
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
  await expect(page.getByRole('button', { name: 'Importar seleccionadas' })).toBeDisabled(); // nothing is selected yet

  // 1. Two similar subjects: the student chooses (no default).
  const ambiguous = card(page, 0);
  await expect(ambiguous.getByRole('group', { name: '¿A cuál te refieres?' })).toBeVisible();
  await expect(ambiguous.getByLabel('Asignatura')).toHaveValue('');
  await expect(ambiguous.getByLabel(/Incluir/)).toBeDisabled();
  await ambiguous.getByLabel('Programación II').check();
  await expect(ambiguous.getByLabel('Asignatura')).toContainText('Programación II');

  // 2. Unknown subject: manual choice among the user's subjects.
  const unknown = card(page, 1);
  await expect(unknown).toContainText('Asignatura sin reconocer');
  await unknown.getByLabel('Asignatura').selectOption({ label: 'Programación I' });
  await expect(unknown.getByLabel('Título')).toHaveValue('Programación I');

  // 3. Only a start time and a similar name: suggestion + missing end time.
  const partial = card(page, 2);
  await expect(partial).toContainText('¿Quisiste decir Redes de Computadores?');
  await expect(partial).toContainText('Para importarla falta la asignatura, la hora de fin');
  await partial.getByRole('button', { name: 'Sí, es Redes de Computadores' }).click();
  await expect(partial.getByLabel('Asignatura')).toContainText('Redes de Computadores');
  await expect(partial.getByLabel(/Incluir/)).toBeDisabled(); // still no end time
  await partial.getByLabel('Fin', { exact: true }).fill('07:00');
  await expect(partial).toContainText('La hora de fin debe ser posterior');
  await partial.getByLabel('Fin', { exact: true }).fill('09:00');
  await expect(partial.getByLabel(/Incluir/)).toBeEnabled();

  // Now all three are complete: select them all and import.
  await page.getByRole('button', { name: 'Seleccionar todas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Importar seleccionadas' })).toBeEnabled();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '3 clases importadas, 0 necesitan corrección' }),
  ).toBeVisible();
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
  await expect(card(page, 1)).toContainText(/Conflicto con Redes, lunes 08:00–10:00/);
  await card(page, 1)
    .getByLabel(/Incluir/)
    .check();
  await page.getByRole('button', { name: 'Importar seleccionadas' }).click();
  await expect(card(page, 1)).toContainText('Clase importada'); // it did not block
});

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
