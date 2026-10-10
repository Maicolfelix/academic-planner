import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  bogotaToday,
  completeOnboarding,
  inBogota,
  register,
  uniqueEmail,
} from './helpers';

/**
 * Security checks in a real browser against the PRODUCTION topology (the API serves the built app on one origin,
 * with the real headers). Run with `npm run test:security:browser`.
 */

const XSS = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=2</script>',
  '"><svg/onload=window.__xss=3>',
];

async function newUser(page: Page) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Semestre de prueba', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  await addSubjectViaUi(page, 'Redes');
  return email;
}

/** Collects Content-Security-Policy violations (the event) from the first byte of every page. */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${e.sample}`,
      ),
    );
  });
  const consoleCsp: string[] = [];
  page.on(
    'console',
    (m) =>
      /Content Security Policy|violates the following/i.test(m.text()) && consoleCsp.push(m.text()),
  );
  return {
    violations: async () => [
      ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? [])),
      ...consoleCsp,
    ],
  };
}

test('the page is served with a strict CSP and no inline script it would have to allow', async ({
  page,
  request,
}) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy']!;
  expect(csp).toContain("script-src 'self'");
  expect(csp.split(';').find((d) => d.startsWith('script-src'))).not.toMatch(/unsafe-/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(res.headers()['permissions-policy']).toContain('camera=()');
  const html = await res.text();
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
  await page.goto('/login');
});

test('the whole app works under the CSP: zero violations across every screen, the worker and a dialog', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const csp = await watchCsp(page);
  await newUser(page);
  await apiCreateActivity(page, {
    subjectId: (await apiSubjects(page))[0]!.id,
    title: 'Parcial',
    type: 'EXAM',
    ...inBogota(2 * 86400e3),
  });
  for (const route of [
    '/dashboard',
    '/subjects',
    '/activities',
    '/calendar',
    '/radar',
    '/progress',
    '/inbox',
    '/calendar/import',
  ]) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    expect(await csp.violations(), route).toEqual([]);
  }
  // A dialog (native <dialog>, inline style attributes, the form) and the weekly grid's positioned blocks.
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await csp.violations()).toEqual([]);
  // The service worker registers and controls the page under `worker-src 'self'`.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  expect(await csp.violations()).toEqual([]);
});

test('the CSP is really enforced: injected inline script, eval and foreign scripts do not run', async ({
  page,
}) => {
  const csp = await watchCsp(page);
  await page.goto('/login');
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__injected = 1';
    document.body.append(s);
    const f = document.createElement('script');
    f.src = 'https://evil.example/x.js';
    document.body.append(f);
    // String evaluation scheduled for LATER (the DevTools evaluate call itself is exempt from the CSP).
    window.setTimeout('window.__evaled = 1', 0);
  });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => [
      (window as never as Record<string, unknown>).__injected,
      (window as never as Record<string, unknown>).__evaled,
    ]),
  ).toEqual([undefined, undefined]);
  expect((await csp.violations()).length).toBeGreaterThanOrEqual(2);
});

test('stored XSS: markup typed by a user is shown as text everywhere and never runs', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await newUser(page);
  const redes = (await apiSubjects(page))[0]!;
  const subject = await page.request.post('/api/subjects', {
    data: { periodId: redes.periodId, name: XSS[1] },
  });
  expect(subject.status()).toBe(201);
  const subjectId = (await subject.json()).subject.id as string;
  for (const [i, title] of XSS.entries()) {
    await apiCreateActivity(page, {
      subjectId,
      title,
      description: title,
      type: 'EXAM',
      ...inBogota((i + 1) * 86400e3),
    });
  }
  for (const route of [
    '/dashboard',
    '/activities',
    '/radar',
    '/progress',
    '/calendar',
    '/subjects',
  ]) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(() => (window as never as Record<string, unknown>).__xss),
      route,
    ).toBeUndefined();
  }
  // It is on the page as TEXT, not as elements.
  await page.goto('/activities');
  await expect(page.getByText(XSS[0]!).first()).toBeVisible();
  expect(await page.locator('main img[src="x"], main svg[onload], main script').count()).toBe(0);
  // Typed into the parsers too: the raw segment is displayed as text.
  await page.goto('/inbox');
  await page
    .getByLabel('Mensaje del profesor o instrucción académica')
    .fill(`El viernes tendremos parcial de Redes. ${XSS[0]}`);
  await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
  expect(
    await page.evaluate(() => (window as never as Record<string, unknown>).__xss),
  ).toBeUndefined();
  // What is kept as a draft is the student's own text and decisions: nothing of the session.
  const stored = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([k]) => k.startsWith('academic-planner:draft:'))
      .map(([, v]) => v)
      .join(' '),
  );
  expect(stored).not.toMatch(/csrf|token|password|session|@/i);
  await page.goto('/dashboard');
  await page.getByLabel('Escribe lo que tienes pendiente').fill(`parcial redes viernes ${XSS[2]}`);
  await page.getByRole('button', { name: 'Interpretar', exact: true }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(
    await page.evaluate(() => (window as never as Record<string, unknown>).__xss),
  ).toBeUndefined();
});

test('the session cookie is invisible to scripts and has the attributes the documentation promises', async ({
  page,
  context,
}) => {
  await newUser(page);
  expect(await page.evaluate(() => document.cookie)).toBe('');
  const [cookie] = (await context.cookies()).filter((c) => /academic_planner_session/.test(c.name));
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(cookie!.name).toBe('academic_planner_session'); // plain HTTP: no __Host- prefix (that one needs HTTPS)
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000);
  expect(cookie!.expires).toBeLessThanOrEqual(Date.now() / 1000 + 7 * 86400 + 60);
});

test('after logging out, Back and the cache reveal nothing private, and the old session is dead', async ({
  page,
  context,
}) => {
  await newUser(page);
  await apiCreateActivity(page, {
    subjectId: (await apiSubjects(page))[0]!.id,
    title: 'Actividad privada muy secreta',
    type: 'EXAM',
    ...inBogota(2 * 86400e3),
  });
  await page.goto('/activities');
  await expect(page.getByText('Actividad privada muy secreta')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cookie = (await context.cookies()).find((c) => /academic_planner_session/.test(c.name))!;

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Actividad privada muy secreta')).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
  // Nothing private is in the browser's cache storage, before or after.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const n of await caches.keys())
      for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.filter((u) => u.startsWith('/api/'))).toEqual([]);
  // The server really ended the session: the copied cookie no longer works.
  const stale = await page.request.get('/api/activities', {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  expect(stale.status()).toBe(401);
  // And so does the offline path: no data from nowhere.
  await context.setOffline(true);
  await page.goto('/activities').catch(() => undefined);
  await expect(page.getByText('Actividad privada muy secreta')).toHaveCount(0);
  await context.setOffline(false);
});

test('a real cross-site page can not act as the student (CSRF in a browser)', async ({
  page,
  request,
}) => {
  const email = await newUser(page);
  const subjectId = (await apiSubjects(page))[0]!.id;
  const before = (await (await page.request.get('/api/activities')).json()).activities
    .length as number;

  // The "attacker" page lives on another origin (127.0.0.1 is a different site than localhost) and tries to ride
  // the student's session with a credentialed cross-origin request.
  const attacker = await page.context().newPage();
  await attacker.goto('http://127.0.0.1:4300/login');
  const outcome = await attacker.evaluate(async (subject) => {
    try {
      const r = await fetch('http://localhost:4300/api/activities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: subject,
          title: 'Plantada por otro sitio',
          dueDate: '2099-01-01',
        }),
      });
      return `status ${r.status}`;
    } catch (e) {
      return `blocked: ${(e as Error).name}`;
    }
  }, subjectId);
  expect(outcome).toMatch(/^blocked|^status 40[13]/);
  await attacker.close();

  // And a forged request carrying the student's cookie but a foreign Origin is refused by the server itself.
  const cookies = await page.context().cookies();
  const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const forged: Record<string, string>[] = [
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of forged) {
    const res = await request.post('/api/activities', {
      headers: { Cookie: header, ...headers },
      data: { subjectId, title: 'Forjada', dueDate: '2099-01-01' },
    });
    expect(res.status(), JSON.stringify(headers)).toBe(403);
  }
  const after = (await (await page.request.get('/api/activities')).json()).activities
    .length as number;
  expect(after).toBe(before);
  expect(email).toContain('@');
});

test('the server hands out only the app: no dotfiles, no traversal, no listing, API 404s stay JSON', async ({
  request,
}) => {
  for (const p of [
    '/.env',
    '/.git/config',
    '/..%2f..%2fpackage.json',
    '/%2e%2e/%2e%2e/.env',
    '/assets/',
    '/apps/api/src/server.ts',
    '/package.json',
  ]) {
    const res = await request.get(p);
    const text = await res.text();
    expect(text, p).not.toMatch(/DATABASE_URL|"workspaces"|express\(|passwordHash/);
    expect(res.headers()['content-security-policy'], p).toBeTruthy();
  }
  const api = await request.get('/api/does-not-exist');
  expect(api.status()).toBe(404);
  expect(api.headers()['content-type']).toMatch(/json/);
  expect(api.headers()['cache-control']).toBe('no-store');
  const deep = await request.get('/calendar/import');
  expect(deep.status()).toBe(200);
  expect(await deep.text()).toContain('<div id="root">');
  const maps = await request.get('/assets/index.js.map');
  expect(maps.status()).toBe(404);
});

test('an invalid upload is refused with a clear message and leaves nothing behind', async ({
  page,
}) => {
  await newUser(page);
  await page.goto('/calendar/import');
  await page.getByLabel('Archivo del horario (imagen PNG o JPG, o PDF)').setInputFiles({
    name: 'horario.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<?php system($_GET[1]); ?>'),
  });
  await page.getByRole('button', { name: 'Procesar horario' }).click();
  await expect(page.getByRole('alert')).toContainText('Formato no compatible');
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const n of await caches.keys())
      for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.filter((u) => u.includes('schedule-import'))).toEqual([]);
});
