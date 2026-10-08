import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** "Añadir al calendario" (A4.1): one click on an activity downloads an .ics. No external app is opened here. */

async function userWithSubject(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Bioestadística');
  return (await apiSubjects(page))[0]!;
}

const card = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });
const addButton = (page: Page, title: string) =>
  page.getByRole('button', { name: `Añadir al calendario: ${title}`, exact: true });

/** Clicks the button and returns the downloaded file's name and text, after the API answered 200. */
async function download(page: Page, title: string) {
  const [response, file] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/calendar.ics')),
    page.waitForEvent('download'),
    addButton(page, title).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { name: file.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}

const lines = (text: string) => text.replaceAll('\r\n ', '').split('\r\n').slice(0, -1);
const prop = (text: string, name: string) =>
  lines(text).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

test('an activity without a time downloads an all-day event', async ({ page }) => {
  const assertClean = watch(page);
  const subject = await userWithSubject(page);
  await apiCreateActivity(page, {
    subjectId: subject.id,
    title: 'Taller de Bioestadística',
    dueDate: '2099-03-13',
  });

  await page.goto('/activities');
  await expect(card(page, 'Taller de Bioestadística')).toBeVisible();
  const button = addButton(page, 'Taller de Bioestadística');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Añadir al calendario');
  const box = await button.boundingBox();
  expect(box!.height, 'touch target').toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  const { name, text } = await download(page, 'Taller de Bioestadística');

  expect(name).toBe('academic-planner-activity.ics');
  expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(prop(text, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20990313');
  expect(prop(text, 'DTEND')).toBe('DTEND;VALUE=DATE:20990314');
  expect(prop(text, 'SUMMARY')).toBe('SUMMARY:Taller de Bioestadística — Bioestadística');
  for (const absent of ['METHOD', 'VALARM', 'SEQUENCE', 'DESCRIPTION', 'ATTENDEE', 'ORGANIZER']) {
    expect(text, absent).not.toContain(absent);
  }
  // Nothing about the user in the file.
  expect(text).not.toContain('@example.com');
  expect(text).not.toContain('Ana Pérez');
  await expect(page.getByRole('alert')).toHaveCount(0);
  assertClean();
});

test('an activity with a time downloads a 15-minute block that ends at its hour', async ({
  page,
}) => {
  const assertClean = watch(page);
  const subject = await userWithSubject(page);
  await apiCreateActivity(page, {
    subjectId: subject.id,
    title: 'Parcial de Redes',
    type: 'EXAM',
    dueDate: '2099-03-11',
    dueTime: '08:30',
  });

  await page.goto('/activities');
  const { text } = await download(page, 'Parcial de Redes');

  // 08:30 in Bogotá (UTC-5) is 13:30Z; the block is 08:15-08:30.
  expect(prop(text, 'DTSTART')).toBe('DTSTART:20990311T131500Z');
  expect(prop(text, 'DTEND')).toBe('DTEND:20990311T133000Z');
  assertClean();
});

test('a hostile title cannot add properties or components to the file', async ({ page }) => {
  const assertClean = watch(page);
  const subject = await userWithSubject(page);
  const title =
    'Parcial\r\nBEGIN:VEVENT\r\nUID:injected\r\nATTENDEE;CN=X:mailto:x@example.test, con; y \\';
  await apiCreateActivity(page, { subjectId: subject.id, title, dueDate: '2099-03-11' });

  await page.goto('/activities');
  // The accessible name keeps the title as the user typed it (line breaks collapse in the accessibility tree).
  const hostileButton = page.getByRole('button', { name: /^Añadir al calendario: Parcial/ });
  const [file] = await Promise.all([page.waitForEvent('download'), hostileButton.click()]);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');

  const names = lines(text).map((l) => l.split(/[:;]/)[0]);
  expect(names.filter((n) => n === 'BEGIN')).toEqual(['BEGIN', 'BEGIN']);
  expect(names).not.toContain('ATTENDEE');
  expect(lines(text).filter((l) => l.startsWith('UID:'))).toHaveLength(1);
  expect(prop(text, 'SUMMARY')).toContain('Parcial\\nBEGIN:VEVENT\\nUID:injected');
  assertClean();
});

test.describe('failure', () => {
  test.use({ serviceWorkers: 'block' });

  test('a failed download says so and can be retried', async ({ page }) => {
    const subject = await userWithSubject(page);
    await apiCreateActivity(page, {
      subjectId: subject.id,
      title: 'Taller de Bioestadística',
      dueDate: '2099-03-13',
    });
    await page.goto('/activities');
    await expect(card(page, 'Taller de Bioestadística')).toBeVisible();

    let fail = true;
    await page.route('**/calendar.ics', (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
          })
        : route.continue(),
    );

    await addButton(page, 'Taller de Bioestadística').click();
    await expect(page.getByRole('alert')).toContainText('No se pudo descargar el archivo');
    await expect(addButton(page, 'Taller de Bioestadística')).toBeEnabled();

    fail = false;
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      addButton(page, 'Taller de Bioestadística').click(),
    ]);
    expect(file.suggestedFilename()).toBe('academic-planner-activity.ics');
  });
});

test('the activities page with the new button passes axe and stays within the screen', async ({
  page,
}) => {
  const subject = await userWithSubject(page);
  await apiCreateActivity(page, {
    subjectId: subject.id,
    title:
      'Entrega final del proyecto integrador: documento de arquitectura, manual de usuario y pruebas',
    dueDate: '2099-03-13',
  });
  await page.goto('/activities');
  await expect(page.getByRole('button', { name: /^Añadir al calendario/ })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await expectNoHorizontalOverflow(page);
});

test('a visitor without a session gets a 401, never a file', async ({ request }) => {
  const res = await request.get(
    '/api/activities/00000000-0000-4000-8000-000000000000/calendar.ics',
  );
  expect(res.status()).toBe(401);
  expect(res.headers()['content-disposition']).toBeUndefined();
});
