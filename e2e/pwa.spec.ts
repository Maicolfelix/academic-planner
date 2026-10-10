import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

const OFFLINE = 'Academic Planner está sin conexión. Algunas funciones no están disponibles.';

/** First visit installs the service worker; a reload makes it control the page (generateSW does not claim). */
async function controlled(page: Page, path = '/status') {
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** Every URL stored in Cache Storage, from all caches. */
const cachedUrls = (page: Page) =>
  page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    return urls;
  });

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  await addSubjectViaUi(page, 'Redes');
}

test.describe('manifest and icons', () => {
  test('the manifest is valid, complete and every icon is reachable', async ({ page, request }) => {
    await page.goto('/status');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest).toMatchObject({
      name: 'Academic Planner',
      short_name: 'Planner',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#0f172a',
      background_color: '#ffffff',
      lang: 'es',
    });
    expect(manifest.description).toBeTruthy();
    for (const size of ['192x192', '512x512'])
      expect(
        manifest.icons.some(
          (i: { sizes: string; purpose: string }) => i.sizes === size && i.purpose === 'any',
        ),
        size,
      ).toBe(true);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toContain('image/png');
    }
    // The page declares its own metadata too.
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f172a');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png',
    );
    expect((await request.get('/apple-touch-icon.png')).status()).toBe(200);
  });
});

test.describe('service worker', () => {
  test('is registered, active, controls the page and precaches the shell', async ({ page }) => {
    await controlled(page);
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { scope: new URL(reg!.scope).pathname, active: reg!.active?.state };
    });
    expect(state).toEqual({ scope: '/', active: 'activated' });
    const urls = await cachedUrls(page);
    expect(urls).toContain('/index.html');
    expect(urls.some((u) => u.startsWith('/assets/') && u.endsWith('.js'))).toBe(true);
    expect(urls).toContain('/manifest.webmanifest');
  });

  test('the generated worker never caches the API', async ({ request }) => {
    const sw = await (await request.get('/sw.js')).text();
    expect(sw).toContain('NetworkOnly');
    expect(sw).toMatch(/\/api\//);
    // No strategy that could keep private responses.
    expect(sw).not.toMatch(/CacheFirst|NetworkFirst|StaleWhileRevalidate/);
  });

  test('private API responses are never in Cache Storage, before and after logout', async ({
    page,
  }) => {
    await newUser(page);
    await controlled(page, '/dashboard');
    await apiCreateActivity(page, {
      title: 'Secreto XYZ',
      type: 'EXAM',
      dueDate: bogotaToday(3),
    }).catch(() => undefined);
    await page.goto('/activities');
    await page.waitForLoadState('networkidle');
    expect((await cachedUrls(page)).filter((u) => u.startsWith('/api/'))).toEqual([]);

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await cachedUrls(page)).filter((u) => u.startsWith('/api/'))).toEqual([]);

    // Back/offline after logout: the shell may open, private data must not.
    await page.context().setOffline(true);
    await page.goto('/activities');
    await expect(page.getByText('Secreto XYZ')).toHaveCount(0);
    await page.context().setOffline(false);
  });
});

test.describe('routing', () => {
  test('deep links and reloads work with the service worker in control', async ({ page }) => {
    await newUser(page);
    await controlled(page, '/dashboard');
    for (const [path, name] of [
      ['/dashboard', undefined],
      ['/activities', undefined],
      ['/calendar', undefined],
      ['/radar', undefined],
      ['/progress', undefined],
      ['/inbox', 'Bandeja académica'],
    ] as const) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      if (name) await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    }
  });

  test('/api is never answered with the app shell, not even on navigation', async ({ page }) => {
    await controlled(page);
    const res = await page.goto('/api/health');
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-type']).toContain('application/json');
  });
});

test.describe('offline', () => {
  test('the shell opens offline with a clear message, no data, and recovers online', async ({
    page,
  }) => {
    await newUser(page);
    await controlled(page, '/dashboard');

    await page.context().setOffline(true);
    await page.reload(); // served by the service worker, not a browser error page
    await expect(page.getByRole('alert')).toHaveText(OFFLINE);
    await expect(page.getByText('Puedes abrir Academic Planner')).toHaveCount(2); // banner + detail
    await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
    await expect(page.getByText('Redes')).toHaveCount(0); // no academic data

    await page.context().setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('an action that needs the backend fails clearly offline and works once back online', async ({
    page,
  }) => {
    await newUser(page);
    await controlled(page, '/inbox');
    await page
      .getByLabel('Mensaje del profesor o instrucción académica')
      .fill('Parcial de Redes el viernes.');

    await page.context().setOffline(true);
    await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
    await expect(page.getByRole('alert')).toContainText('No pudimos interpretar el texto');
    await expect(page.getByRole('article')).toHaveCount(0); // nothing pretends to have worked
    await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
    await expect(page.getByLabel('Mensaje del profesor o instrucción académica')).not.toHaveValue(
      '',
    ); // text kept

    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Interpretar mensaje' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
  });

  test('on a phone the offline notice fits and does not cover the navigation', async ({ page }) => {
    await newUser(page);
    await controlled(page, '/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // loaded before the connection drops
    await page.context().setOffline(true);
    const notice = page.getByRole('status').filter({ hasText: 'Sin conexión' });
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(notice).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    const [n, nav] = await Promise.all([
      notice.boundingBox(),
      page.getByRole('navigation', { name: 'Principal' }).boundingBox(),
    ]);
    expect(n!.y + n!.height).toBeLessThanOrEqual(nav!.y + 1); // above it, in the flow
    await page.context().setOffline(false);
  });
});

test.describe('install', () => {
  const fireInstallEvent = (page: Page, outcome: 'accepted' | 'dismissed') =>
    page.evaluate((o) => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(e, {
        prompt: async () => {
          (window as unknown as { __prompted: number }).__prompted =
            ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1;
        },
        userChoice: Promise.resolve({ outcome: o }),
      });
      window.dispatchEvent(e);
    }, outcome);

  test('no install button unless the browser offers installation', async ({ page }) => {
    await newUser(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Instalar Academic Planner' })).toHaveCount(0);
  });

  for (const outcome of ['accepted', 'dismissed'] as const) {
    test(`the install button calls the browser prompt once (${outcome})`, async ({ page }) => {
      await newUser(page);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await fireInstallEvent(page, outcome);
      const button = page.getByRole('button', { name: 'Instalar Academic Planner' });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
      await button.click();
      await expect(button).toHaveCount(0); // the event can be used once
      expect(
        await page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted),
      ).toBe(1);
    });
  }

  test('an installed (standalone) app never offers installation', async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q.includes('display-mode: standalone')
          ? ({
              matches: true,
              media: q,
              addEventListener() {},
              removeEventListener() {},
            } as unknown as MediaQueryList)
          : original(q);
    });
    await newUser(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await fireInstallEvent(page, 'accepted');
    await expect(page.getByRole('button', { name: 'Instalar Academic Planner' })).toHaveCount(0);
  });

  test('iOS Safari gets a one-line hint instead of a button', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () =>
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      });
    });
    await newUser(page);
    await page.goto('/dashboard');
    await expect(
      page.getByText('En Safari, usa Compartir → Agregar a pantalla de inicio.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Instalar Academic Planner' })).toHaveCount(0);
  });
});

test('the service worker does not add console errors or failed requests to a normal session', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await controlled(page, '/dashboard');
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Bandeja académica' })).toBeVisible();
  assertClean();
});
