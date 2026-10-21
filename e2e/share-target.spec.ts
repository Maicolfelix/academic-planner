import { expect, test, type Page } from '@playwright/test';
import {
  PASSWORD,
  addSubjectViaUi,
  bogotaToday,
  completeOnboarding,
  expectNoHorizontalOverflow,
  login,
  register,
  uniqueEmail,
  watch,
} from './helpers';

test.setTimeout(90_000);

const period = () => ({ start: bogotaToday(-70), end: bogotaToday(120) });
const box = (page: Page) => page.getByLabel('Escribe lo que tienes pendiente');
const KEY = 'academic-planner:shared-capture';

async function newUser(page: Page) {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Semestre de prueba', period());
  await addSubjectViaUi(page, 'Redes'); // the Quick Capture is shown once there is a subject
  await page.goto('/dashboard');
  await expect(box(page)).toBeVisible();
  return email;
}

const activityCount = async (page: Page) =>
  (await (await page.request.get('/api/activities')).json()).activities.length as number;

test('logged in: title, text and link arrive in the Quick Capture, out of the URL, creating nothing', async ({
  page,
}) => {
  const assertClean = watch(page);
  await newUser(page);
  await page.goto(
    '/share?title=Tarea&text=Entrega%20viernes&url=' +
      encodeURIComponent('https://example.com/t/3'),
  );
  await expect(page).toHaveURL(/\/dashboard$/); // replaced: nothing of the share stays in the address bar
  expect(page.url()).not.toContain('Entrega');
  await expect(box(page)).toHaveValue('Tarea\nEntrega viernes\nhttps://example.com/t/3');
  expect(await activityCount(page)).toBe(0);

  // Taken once: the stored share is gone, and a reload does not inject it again.
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
  await box(page).fill(''); // the student clears the box
  await page.reload();
  await expect(box(page)).toHaveValue('');

  // The normal flow takes over: interpret the shared text like any typed one. Proposing is not creating.
  await page.goto('/share?text=' + encodeURIComponent('Parcial de redes el martes a las 10 am'));
  await expect(box(page)).toHaveValue('Parcial de redes el martes a las 10 am');
  await page.getByRole('button', { name: 'Interpretar' }).click();
  await expect(page.getByRole('button', { name: /^Crear / })).toBeVisible();
  expect(await activityCount(page)).toBe(0);
  await assertClean();
});

test('logged out: the share survives the login and the text is not in the URL', async ({
  page,
}) => {
  const email = await newUser(page);
  await page.waitForLoadState('networkidle');
  await page.context().clearCookies();

  await page.goto('/share?text=' + encodeURIComponent('Parcial mañana'));
  await expect(page).toHaveURL(/\/login$/);
  expect(page.url()).not.toContain('Parcial');
  await login(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(box(page)).toHaveValue('Parcial mañana');
  expect(page.url()).not.toContain('Parcial');
});

test('logged out: the login returns to an internal page', async ({ page }) => {
  const email = await newUser(page);
  await page.waitForLoadState('networkidle');
  await page.context().clearCookies();
  await page.goto('/activities');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/activities$/);
});

test('an unfinished draft is never overwritten silently: keep it or use what was shared', async ({
  page,
}) => {
  await newUser(page);
  await box(page).fill('Quiz de Anatomía');
  await page.waitForTimeout(300); // the draft is written as it is typed

  await page.goto('/share?text=' + encodeURIComponent('Parcial de Fisiología'));
  const group = page.getByRole('group', { name: 'Tienes un borrador en Captura rápida.' });
  await expect(group).toBeVisible();
  await expect(box(page)).toHaveValue('Quiz de Anatomía'); // nothing replaced yet
  await group.getByRole('button', { name: 'Mantener mi borrador' }).click();
  await expect(group).toBeHidden();
  await expect(box(page)).toHaveValue('Quiz de Anatomía');

  await page.goto('/share?text=' + encodeURIComponent('Parcial de Fisiología'));
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: 'Usar lo compartido' }).click();
  await expect(box(page)).toHaveValue('Parcial de Fisiología');
  await page.reload();
  await expect(box(page)).toHaveValue('Parcial de Fisiología');
  expect(await activityCount(page)).toBe(0);
});

test('with a draft, using a cut or link-dropping share tells what was cut; keeping the draft tells nothing', async ({
  page,
}) => {
  await newUser(page);
  const group = page.getByRole('group', { name: 'Tienes un borrador en Captura rápida.' });
  const cutNotice = page.getByText('Lo compartido era muy largo y se recortó.');
  const linkNotice = page.getByText('Se omitió un enlace que no era http ni https.');
  const keep = async () => {
    await box(page).fill('Quiz de Anatomía');
    await page.waitForTimeout(300); // the draft is written as it is typed
  };

  // Too long + a draft: nothing is told while the student decides; keeping the draft leaves no stale warning.
  await keep();
  await page.goto('/share?text=' + encodeURIComponent('x'.repeat(8000)));
  await expect(group).toBeVisible();
  await expect(cutNotice).toBeHidden();
  await group.getByRole('button', { name: 'Mantener mi borrador' }).click();
  await expect(box(page)).toHaveValue('Quiz de Anatomía');
  await expect(cutNotice).toBeHidden();

  // Too long + a draft + "use it": the cut text enters AND the notice is shown; the share was taken once.
  await page.goto('/share?text=' + encodeURIComponent('x'.repeat(8000)));
  await expect(page).toHaveURL(/\/dashboard$/);
  await group.getByRole('button', { name: 'Usar lo compartido' }).click();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull(); // taken once the choice is made
  await expect(cutNotice).toBeVisible();
  expect((await box(page).inputValue()).length).toBeLessThanOrEqual(5000);
  await page.reload();
  await expect(cutNotice).toBeHidden(); // a reload does not bring the share (or its notice) back
  expect((await box(page).inputValue()).length).toBeGreaterThan(0); // the used text is a normal draft now

  // An unsafe link + a draft + "use it": no execution, the link is absent, the notice says it was dropped.
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await keep();
  await page.goto('/share?text=Tarea&url=' + encodeURIComponent('javascript:alert(1)'));
  await expect(group).toBeVisible();
  await expect(linkNotice).toBeHidden();
  await group.getByRole('button', { name: 'Usar lo compartido' }).click();
  await expect(box(page)).toHaveValue('Tarea');
  await expect(linkNotice).toBeVisible();
  expect(dialogs).toBe(0);

  // And keeping the draft in that case leaves no link warning behind.
  await keep();
  await page.goto('/share?text=Tarea&url=' + encodeURIComponent('javascript:alert(1)'));
  await group.getByRole('button', { name: 'Mantener mi borrador' }).click();
  await expect(box(page)).toHaveValue('Quiz de Anatomía');
  await expect(linkNotice).toBeHidden();
});

test('QA case: the exact share arrives, becomes a normal draft, and a reload neither loses nor duplicates it', async ({
  page,
}) => {
  await newUser(page);
  await page.goto('/share?title=Tarea&text=Entrega%20viernes&url=https%3A%2F%2Fexample.com');
  const expected = ['Tarea', 'Entrega viernes', 'https://example.com'].join('\n');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(box(page)).toHaveValue(expected);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
  const draft = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([k]) => k.includes(':capture-quick'))
      .map(([, v]) => v),
  );
  expect(draft).toHaveLength(1);
  expect(draft[0]).toContain('Entrega viernes');
  await page.reload();
  await expect(box(page)).toHaveValue(expected); // the draft, once; not the share injected a second time
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
});

test('a share is not lost if the draft cannot be written: it stays until it is safely kept', async ({
  page,
}) => {
  await newUser(page);
  // Storage refuses the draft (full quota, a blocked profile…): the old hand-off had already removed the share by then.
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (
        this === window.localStorage &&
        k.includes(':capture-quick') &&
        sessionStorage.getItem('qa-fail-draft') === '1'
      )
        throw new Error('QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  await page.evaluate(() => sessionStorage.setItem('qa-fail-draft', '1'));
  await page.goto('/share?text=' + encodeURIComponent('Parcial de redes'));
  await expect(box(page)).toHaveValue('Parcial de redes'); // shown from memory
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).not.toBeNull(); // not removed: nothing kept it yet

  // Storage works again: the share (still within its ten minutes) is delivered and only then removed.
  await page.evaluate(() => sessionStorage.removeItem('qa-fail-draft'));
  await page.reload();
  await expect(box(page)).toHaveValue('Parcial de redes');
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
  await page.reload();
  await expect(box(page)).toHaveValue('Parcial de redes'); // now a normal draft, once
});

test('"Usar lo compartido" with a failed first write leaves no hidden pending write and the share retries cleanly', async ({
  page,
}) => {
  await newUser(page);
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (
        this === window.localStorage &&
        k.includes(':capture-quick') &&
        sessionStorage.getItem('qa-fail-draft') === '1'
      )
        throw new Error('QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  const draftText = () =>
    page.evaluate(() => {
      const raw = Object.entries(localStorage).find(([k]) => k.includes(':capture-quick'))?.[1];
      return raw ? (JSON.parse(raw).payload.text as string) : null;
    });
  const stored = () => page.evaluate((k) => sessionStorage.getItem(k), KEY);
  const group = page.getByRole('group', { name: 'Tienes un borrador en Captura rápida.' });

  await box(page).fill('Quiz de Anatomía');
  await expect.poll(draftText).toBe('Quiz de Anatomía');

  // The write of the shared text fails; storage is back to normal right after the click, before any debounce could fire.
  await page.evaluate(() => sessionStorage.setItem('qa-fail-draft', '1'));
  await page.goto('/share?text=' + encodeURIComponent('Parcial de Fisiología'));
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: 'Usar lo compartido' }).click();
  await page.evaluate(() => sessionStorage.removeItem('qa-fail-draft'));
  await expect(box(page)).toHaveValue('Parcial de Fisiología'); // shown from memory
  await page.waitForTimeout(900); // well past the 300 ms debounce: a hidden deferred write would have landed by now
  expect(await draftText()).toBe('Quiz de Anatomía'); // nothing was written behind our back
  expect(await stored()).not.toBeNull(); // and the share was not taken: it was never kept

  // Retry (a reload asks again, inside the ten minutes): now it is written ONCE, then taken, and a reload does not ask again.
  await page.reload();
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: 'Usar lo compartido' }).click();
  await expect.poll(draftText).toBe('Parcial de Fisiología');
  expect(await stored()).toBeNull();
  await page.reload();
  await expect(group).toBeHidden();
  await expect(box(page)).toHaveValue('Parcial de Fisiología');
});

test('an undecided conflict survives a reload and ends only with the decision', async ({
  page,
}) => {
  await newUser(page);
  await box(page).fill('Quiz de Anatomía');
  await page.waitForTimeout(300);
  await page.goto('/share?text=' + encodeURIComponent('Parcial de Fisiología'));
  const group = page.getByRole('group', { name: 'Tienes un borrador en Captura rápida.' });
  await expect(group).toBeVisible();
  await page.reload();
  await expect(group).toBeVisible(); // the share was not lost by looking away
  await group.getByRole('button', { name: 'Mantener mi borrador' }).click();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
  await page.reload();
  await expect(group).toBeHidden();
  await expect(box(page)).toHaveValue('Quiz de Anatomía');
});

test('nothing shared: the capture opens with a discreet notice', async ({ page }) => {
  await newUser(page);
  await page.goto('/share');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('No recibimos contenido para compartir.')).toBeVisible();
  await expect(box(page)).toHaveValue('');
});

test('a link that is not http(s) is never carried and nothing runs', async ({ page }) => {
  await newUser(page);
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await page.goto('/share?text=Tarea&url=' + encodeURIComponent('javascript:alert(1)'));
  await expect(box(page)).toHaveValue('Tarea');
  await expect(page.getByText('Se omitió un enlace que no era http ni https.')).toBeVisible();
  expect(dialogs).toBe(0);
  await box(page).fill(''); // the student clears the box

  // Markup in the text is text, never HTML.
  await page.goto('/share?text=' + encodeURIComponent('<img src=x onerror=alert(1)> tarea'));
  await expect(box(page)).toHaveValue('<img src=x onerror=alert(1)> tarea');
  expect(dialogs).toBe(0);
});

test('accents, ñ, emoji and line breaks arrive intact; malformed encoding does not break the page', async ({
  page,
}) => {
  await newUser(page);
  const text = 'Parcial de Bioquímica 🧪\nmañana a las 8';
  await page.goto('/share?text=' + encodeURIComponent(text));
  await expect(box(page)).toHaveValue(text);
  await box(page).fill(''); // the student clears the box

  await page.goto('/share?text=%E0%A4%A&title=%ZZ'); // malformed percent-encoding
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(box(page)).toBeVisible();
});

test('an old share is not revived and a huge one is cut with a notice', async ({ page }) => {
  await newUser(page);
  await page.evaluate((k) => {
    sessionStorage.setItem(
      k,
      JSON.stringify({
        text: 'viejo',
        notices: [],
        receivedAt: Date.now() - 11 * 60 * 1000,
        source: 'share-target',
      }),
    );
  }, KEY);
  await page.goto('/dashboard');
  await expect(box(page)).toHaveValue('');

  await page.goto('/share?text=' + encodeURIComponent('x'.repeat(8000)));
  await expect(page.getByText('Lo compartido era muy largo y se recortó.')).toBeVisible();
  expect((await box(page).inputValue()).length).toBeLessThanOrEqual(5000);
});

test('the manifest declares the share target (text, title and link only)', async ({
  page,
  request,
}) => {
  await page.goto('/status');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href!)).json();
  expect(manifest.share_target).toEqual({
    action: '/share',
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' },
  });
  expect(manifest.share_target.enctype).toBeUndefined(); // no files
});

test('the conflict prompt fits at every width and is operable by keyboard', async ({ page }) => {
  await newUser(page);
  await box(page).fill('Quiz de Anatomía');
  await page.waitForTimeout(300);
  await page.goto('/share?text=Parcial');
  const group = page.getByRole('group', { name: 'Tienes un borrador en Captura rápida.' });
  await expect(group).toBeVisible();
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  for (const name of ['Usar lo compartido', 'Mantener mi borrador']) {
    const b = group.getByRole('button', { name });
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await group.getByRole('button', { name: 'Mantener mi borrador' }).focus();
  await page.keyboard.press('Enter');
  await expect(group).toBeHidden();
});
