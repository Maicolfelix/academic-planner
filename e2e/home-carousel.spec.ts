import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addSubjectViaUi,
  apiCreateActivity,
  apiSubjects,
  completeOnboarding,
  expectNoHorizontalOverflow,
  inBogota,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** The Home hero: up to five next activities by deadline, a snapping strip with dots that are real buttons. */

// The race tests repeat each navigation and wait for animations: they need more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const hero = (page: Page) => page.getByRole('region', { name: '¿Qué hago ahora?' });
const slides = (page: Page) => hero(page).locator('[aria-roledescription="actividad"]');
const onScreen = (page: Page) =>
  hero(page).locator('[aria-roledescription="actividad"]:not([inert])');
const titlesOf = (page: Page) => slides(page).locator('p[id^="attention-activity-"]');
const dots = (page: Page) => hero(page).getByRole('button', { name: /^Ver actividad \d+ de \d+$/ });
const strip = (page: Page) => hero(page).getByRole('group', { name: 'Próximas actividades' });

async function newUser(page: Page) {
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  return (await apiSubjects(page))[0]!;
}

async function make(page: Page, subjectId: string, title: string, offsetMs: number) {
  return apiCreateActivity(page, { subjectId, title, type: 'TASK', ...inBogota(offsetMs) });
}

/** The slide that is really on screen (its centre is the strip's centre), 0-based, whatever the CSS step is. */
const visibleSlide = (page: Page) =>
  strip(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    return Array.from(el.querySelectorAll('[data-slide]')).findIndex((s) => {
      const b = s.getBoundingClientRect();
      return b.left <= mid && b.right >= mid;
    });
  });
/** The strip shows slide `index`. */
const scrolledTo = (page: Page, index: number) => expect.poll(() => visibleSlide(page)).toBe(index);
/** The strip has stopped on slide `index`: that slide's centre is the strip's centre (a smooth scroll is not still on its way). */
const settledOn = (page: Page, index: number) =>
  expect
    .poll(() =>
      strip(page).evaluate((el, i) => {
        const slide = el.querySelectorAll('[data-slide]')[i]!.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return Math.abs(slide.left + slide.width / 2 - (r.left + r.width / 2));
      }, index),
    )
    .toBeLessThan(2);
/** Intent (dot), projection (strip) and content (the slide that is not inert) all agree on `index`. */
async function expectAllAt(page: Page, index: number, title?: string) {
  await expect(dots(page).nth(index)).toHaveAttribute('aria-current', 'true');
  await expect(
    dots(page).evaluateAll(
      (ds) => ds.filter((d) => d.getAttribute('aria-current') === 'true').length,
    ),
  ).resolves.toBe(1);
  await scrolledTo(page, index);
  if (title) await expect(onScreen(page).locator('p[id^="attention-activity-"]')).toHaveText(title);
}

test('up to five activities by deadline, soonest first, whatever their priority; the rest stay out', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const titles = ['Séptima', 'Primera', 'Cuarta', 'Segunda', 'Sexta', 'Tercera', 'Quinta'];
  const offsets = [7, 1, 4, 2, 6, 3, 5];
  for (const [i, t] of titles.entries()) {
    await apiCreateActivity(page, {
      subjectId: redes.id,
      title: t,
      type: 'TASK',
      priority: i === 0 ? 'HIGH' : 'LOW',
      ...inBogota(offsets[i]! * DAY),
    });
  }

  await page.goto('/dashboard');
  await expect(slides(page)).toHaveCount(5);
  await expect(titlesOf(page)).toHaveText(['Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta']);
  await expect(dots(page)).toHaveCount(5);
  await expect(onScreen(page)).toHaveCount(1);
  await expect(onScreen(page).getByRole('article', { name: 'Primera' })).toBeVisible();
  await expect(hero(page)).not.toContainText('Séptima');
  assertClean();
});

test('the dots are buttons: named, current, clickable and driven by the keyboard', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  for (const [i, t] of ['Uno', 'Dos', 'Tres', 'Cuatro'].entries())
    await make(page, redes.id, t, (i + 1) * DAY);

  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(4);
  for (const n of [1, 2, 3, 4])
    await expect(hero(page).getByRole('button', { name: `Ver actividad ${n} de 4` })).toBeVisible();
  await expect(dots(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(dots(page).nth(1)).toHaveAttribute('aria-current', 'false');

  // Click: that activity is on screen, the strip is at its slide, and only its dot is current.
  await hero(page).getByRole('button', { name: 'Ver actividad 3 de 4' }).click();
  await expect(onScreen(page).getByRole('article', { name: 'Tres' })).toBeVisible();
  await expect(dots(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(dots(page).nth(0)).toHaveAttribute('aria-current', 'false');
  await scrolledTo(page, 2);

  // Keyboard: Tab reaches a dot, arrows move through them (focus follows), Home/End jump.
  await dots(page).nth(2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dots(page).nth(3)).toBeFocused();
  await expect(onScreen(page).getByRole('article', { name: 'Cuatro' })).toBeVisible();
  await page.keyboard.press('ArrowRight'); // the last one: stays
  await expect(dots(page).nth(3)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(dots(page).nth(0)).toBeFocused();
  await expect(onScreen(page).getByRole('article', { name: 'Uno' })).toBeVisible();
  await scrolledTo(page, 0);
  await page.keyboard.press('End');
  await expect(onScreen(page).getByRole('article', { name: 'Cuatro' })).toBeVisible();

  // The slide on screen is the only one in the tab order; the dots are part of it.
  await expect(onScreen(page).getByRole('link', { name: /Ver actividad: Cuatro/ })).toBeVisible();
  await expect(onScreen(page).getByRole('link')).toHaveCount(1);
  await expect(hero(page).locator('[inert]')).toHaveCount(3);
  assertClean();
});

test('a single activity is just the hero (no dots), and none at all is the calm empty state', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const done = await make(page, redes.id, 'Hecha', DAY);
  expect(
    (
      await page.request.patch(`/api/activities/${done.id}`, { data: { status: 'COMPLETED' } })
    ).ok(),
  ).toBe(true);
  await page.goto('/dashboard');
  await expect(hero(page)).toContainText('No tienes actividades pendientes en este momento.');
  await expect(dots(page)).toHaveCount(0);

  await make(page, redes.id, 'Única', 2 * DAY);
  await page.goto('/dashboard');
  await expect(slides(page)).toHaveCount(1);
  await expect(dots(page)).toHaveCount(0);
  await expect(onScreen(page).getByRole('article', { name: 'Única' })).toBeVisible();
  assertClean();
});

test('it follows the data: finishing, deleting, a new nearer one and a moved deadline reorder it', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  const a = await make(page, redes.id, 'A', 1 * DAY);
  const b = await make(page, redes.id, 'B', 2 * DAY);
  await make(page, redes.id, 'C', 3 * DAY);
  await page.goto('/dashboard');
  await expect(slides(page)).toHaveCount(3);

  // finish the first: it leaves, the second takes its place
  expect(
    (
      await page.request.patch(`/api/activities/${a.id}`, { data: { status: 'COMPLETED' } })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(slides(page)).toHaveCount(2);
  await expect(onScreen(page).getByRole('article', { name: 'B' })).toBeVisible();
  await expect(dots(page)).toHaveCount(2);

  // a new one that is nearer goes first
  const d = await make(page, redes.id, 'D', 12 * HOUR);
  await page.reload();
  await expect(slides(page)).toHaveCount(3);
  await expect(onScreen(page).getByRole('article', { name: 'D' })).toBeVisible();

  // move B's deadline after C's: the order follows the deadline
  const moved = inBogota(5 * DAY);
  expect((await page.request.patch(`/api/activities/${b.id}`, { data: moved })).status()).toBe(200);
  await page.reload();
  await expect(titlesOf(page)).toHaveText(['D', 'C', 'B']);

  // delete the first: C is on screen with two dots
  expect((await page.request.delete(`/api/activities/${d.id}`)).ok()).toBe(true);
  await page.reload();
  await expect(onScreen(page).getByRole('article', { name: 'C' })).toBeVisible();
  await expect(dots(page)).toHaveCount(2);
  assertClean();
});

test('the strip snaps, a swipe moves the current dot, and a dot moves the strip', async ({
  page,
}) => {
  const assertClean = watch(page);
  const redes = await newUser(page);
  for (const [i, t] of ['Uno', 'Dos', 'Tres'].entries())
    await make(page, redes.id, t, (i + 1) * DAY);
  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(3);

  await expect(strip(page)).toHaveCSS('scroll-snap-type', 'x mandatory');
  // A swipe is a scroll of the strip WITH the student's hand on it (a touch or a wheel): the dot and the slide on screen
  // follow it. (The same scroll with nobody holding the strip is the browser's own doing: the intent stands, see below.)
  await strip(page).dispatchEvent('pointerdown');
  await strip(page).evaluate((el) =>
    el.scrollTo({
      left: el.querySelectorAll<HTMLElement>('[data-slide]')[2]!.offsetLeft,
      behavior: 'instant',
    }),
  );
  await expect(dots(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(onScreen(page).getByRole('article', { name: 'Tres' })).toBeVisible();
  await strip(page).evaluate((el) =>
    el.scrollTo({
      left: el.querySelectorAll<HTMLElement>('[data-slide]')[1]!.offsetLeft,
      behavior: 'instant',
    }),
  );
  await expect(dots(page).nth(1)).toHaveAttribute('aria-current', 'true');
  // ...and a dot moves the strip back (and the state does not bounce while it travels)
  await dots(page).nth(0).click();
  await scrolledTo(page, 0);
  await expect(dots(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(dots(page).nth(1)).toHaveAttribute('aria-current', 'false');
  assertClean();
});

test('a scroll nobody asked for (the browser, not the student) is undone: the intent stands', async ({
  page,
}) => {
  await fiveActivities(page);
  await dots(page).nth(3).click();
  await expectAllAt(page, 3, 'D');
  await page.waitForTimeout(800);
  for (let round = 0; round < REPEAT; round++) {
    await strip(page).evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' })); // nobody touched it
    await expectAllAt(page, 3, 'D'); // back where the intent is
  }
});

test('with reduced motion a dot jumps at once (no smooth scroll)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const redes = await newUser(page);
  for (const [i, t] of ['Uno', 'Dos', 'Tres'].entries())
    await make(page, redes.id, t, (i + 1) * DAY);
  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(3);
  await dots(page).nth(2).click();
  await scrolledTo(page, 2);
  await expect(onScreen(page).getByRole('article', { name: 'Tres' })).toBeVisible();
});

for (const width of [320, 390, 430, 768, 1366]) {
  test(`${width} px: no overflow, dots are comfortable targets, long titles fit and axe passes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const redes = await newUser(page);
    const long = `Entrega ${'muy larga '.repeat(6)}Supercalifragilisticoespialidosoynadamás`;
    await make(page, redes.id, long, 1 * DAY);
    for (const [i, t] of ['Dos', 'Tres', 'Cuatro', 'Cinco'].entries())
      await make(page, redes.id, t, (i + 2) * DAY);
    await page.goto('/dashboard');
    await expect(dots(page)).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
    for (const dot of await dots(page).all()) {
      const box = (await dot.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const card = (await onScreen(page).getByRole('article').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(width);

    await dots(page).nth(3).click();
    await scrolledTo(page, 3);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(700); // let the entrances finish: axe must read the final colors
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

// ───────────────────────── Races: one intent, the strip only follows it ─────────────────────────

const REPEAT = 5;
const NAMES = ['A', 'B', 'C', 'D', 'E'];

async function fiveActivities(page: Page) {
  const redes = await newUser(page);
  for (const [i, t] of NAMES.entries()) await make(page, redes.id, t, (i + 1) * 20 * HOUR);
  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(5);
  await page.waitForTimeout(600); // the entrance
}

test('rapid dots: 5 then 1 right away ends on 1; 5 → 2 → 4 ends on 4; every time', async ({
  page,
}) => {
  const assertClean = watch(page);
  await fiveActivities(page);
  for (let round = 0; round < REPEAT; round++) {
    await dots(page).nth(4).click({ delay: 0 });
    await dots(page).nth(0).click({ delay: 0 });
    await expectAllAt(page, 0, 'A');
    await page.waitForTimeout(900); // nothing old arrives later and moves it
    await expectAllAt(page, 0, 'A');

    await dots(page).nth(4).click({ delay: 0 });
    await dots(page).nth(1).click({ delay: 0 });
    await dots(page).nth(3).click({ delay: 0 });
    await expectAllAt(page, 3, 'D');
    await page.waitForTimeout(900);
    await expectAllAt(page, 3, 'D');
    await dots(page).nth(0).click();
    await expectAllAt(page, 0, 'A');
  }
  assertClean();
});

test('the same dot twice, and a dot for where it already is, leave nothing half done', async ({
  page,
}) => {
  await fiveActivities(page);
  for (let round = 0; round < REPEAT; round++) {
    await dots(page).nth(2).click();
    await dots(page).nth(2).click();
    await expectAllAt(page, 2, 'C');
    await dots(page).nth(2).click(); // already there: no navigation is left "on its way"
    await dots(page).nth(0).click();
    await expectAllAt(page, 0, 'A');
    await page.waitForTimeout(300);
    await expectAllAt(page, 0, 'A');
  }
});

test('the keyboard: several arrows in a row, then Home and End, end where the arithmetic says', async ({
  page,
}) => {
  await fiveActivities(page);
  await dots(page).nth(0).focus();
  for (let round = 0; round < REPEAT; round++) {
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expectAllAt(page, 3, 'D');
    await expect(dots(page).nth(3)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expectAllAt(page, 2, 'C');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); // clamps at the last one
    await expectAllAt(page, 4, 'E');
    await page.keyboard.press('Home');
    await expectAllAt(page, 0, 'A');
    await expect(dots(page).nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expectAllAt(page, 4, 'E');
    await page.keyboard.press('Home');
    await expectAllAt(page, 0, 'A');
  }
});

test('resize in the middle of a navigation keeps the same activity: strip, dot and content agree', async ({
  page,
}) => {
  const assertClean = watch(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await fiveActivities(page);
  for (let round = 0; round < REPEAT; round++) {
    await dots(page).nth(0).click();
    await expectAllAt(page, 0, 'A');
    await dots(page).nth(3).click(); // animating...
    await page.setViewportSize({ width: 900 + round * 40, height: 800 }); // ...and the width changes under it
    await expectAllAt(page, 3, 'D');
    await page.waitForTimeout(900);
    await expectAllAt(page, 3, 'D');
    await expectNoHorizontalOverflow(page);
  }
  assertClean();
});

test('resize at rest (landscape ↔ portrait) keeps the active activity', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await fiveActivities(page);
  await dots(page).nth(2).click();
  await expectAllAt(page, 2, 'C');
  for (let round = 0; round < REPEAT; round++) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectAllAt(page, 2, 'C');
    await page.setViewportSize({ width: 844, height: 390 });
    await expectAllAt(page, 2, 'C');
  }
  await dots(page).nth(4).click();
  await page.setViewportSize({ width: 360, height: 700 });
  await expectAllAt(page, 4, 'E');
});

test('slides are positioned by where they really are: no drift on the last one, at any width', async ({
  page,
}) => {
  await fiveActivities(page);
  for (const width of [320, 390, 430, 768, 1366]) {
    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    await expect(dots(page)).toHaveCount(5);
    await page.waitForTimeout(600); // the entrance
    for (const i of [4, 2, 3, 1, 4]) {
      await dots(page).nth(i).click();
      await expectAllAt(page, i, NAMES[i]);
      await page.waitForTimeout(700);
      // centred: the slide's centre is the strip's centre, within a pixel or two
      const off = await strip(page).evaluate((el, index) => {
        const slide = el.querySelectorAll('[data-slide]')[index]!.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return Math.abs(slide.left + slide.width / 2 - (r.left + r.width / 2));
      }, i);
      expect(off, `width ${width}, slide ${i}`).toBeLessThan(3);
    }
  }
});

test('swipe, then a tap on a dot right away: the last intention wins; then a swipe again', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-360', 'a touch swipe needs the phone project');
  const assertClean = watch(page);
  await fiveActivities(page);
  const cdp = await page.context().newCDPSession(page);
  const viewportHeight = page.viewportSize()!.height;
  const drag = async (fromX: number, toX: number) => {
    // Where the strip is NOW: tapping a dot scrolls the page to the dot, so a box measured earlier points at empty page.
    // The touch goes through the middle of the part of the strip that is on screen, and must land on the strip.
    const box = (await strip(page).boundingBox())!;
    const top = Math.max(box.y, 0);
    const y = Math.round((top + Math.min(box.y + box.height, viewportHeight)) / 2);
    expect(
      await strip(page).evaluate(
        (el, [x, py]) => el.contains(document.elementFromPoint(x!, py!)),
        [fromX, y],
      ),
      'the swipe starts on the strip',
    ).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: fromX, y }],
    });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: fromX + ((toX - fromX) * i) / 10, y }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (let round = 0; round < REPEAT; round++) {
    await drag(300, 60); // swipe to the next one...
    await dots(page).nth(3).tap(); // ...and, before it settles, the student taps dot 4
    await expectAllAt(page, 3, 'D');
    await page.waitForTimeout(800);
    await expectAllAt(page, 3, 'D');
    await dots(page).nth(0).tap();
    await expectAllAt(page, 0, 'A');
    await settledOn(page, 0); // the swipe starts from a strip at rest
    await drag(300, 60);
    await page.waitForTimeout(900); // how far a fling goes depends on its speed: it lands on 2nd or 3rd
    const lit = await dots(page).evaluateAll((ds) =>
      ds.findIndex((d) => d.getAttribute('aria-current') === 'true'),
    );
    expect(lit).toBeGreaterThanOrEqual(1); // a swipe on its own is followed by the dot
    await expectAllAt(page, lit);
    await dots(page).nth(0).tap();
    await expectAllAt(page, 0, 'A');
  }
  assertClean();
});

test('finishing the active activity while the strip is still moving: coherent, on the first one', async ({
  page,
}) => {
  const assertClean = watch(page);
  await page.clock.install();
  const redes = await newUser(page);
  const made: { id: string }[] = [];
  for (const [i, t] of NAMES.entries())
    made.push(await make(page, redes.id, t, (i + 1) * 20 * HOUR));
  await page.goto('/dashboard');
  await expect(dots(page)).toHaveCount(5);
  await dots(page).nth(3).click(); // heading to D...
  // ...and D is finished somewhere else; the next refetch (a minute later on the page's own clock) brings the news
  const res = await page.request.patch(`/api/activities/${made[3]!.id}`, {
    data: { status: 'COMPLETED' },
  });
  expect(res.ok()).toBe(true);
  await page.clock.fastForward(61_000);
  await expect(dots(page)).toHaveCount(4);
  await expect(titlesOf(page)).toHaveText(['A', 'B', 'C', 'E']);
  await page.waitForTimeout(900);
  const where = await visibleSlide(page);
  const lit = await dots(page).evaluateAll((ds) =>
    ds.findIndex((d) => d.getAttribute('aria-current') === 'true'),
  );
  expect([where, lit], 'strip, dot and content agree').toEqual([lit, lit]);
  await expect(onScreen(page)).toHaveCount(1);
  assertClean();
});
