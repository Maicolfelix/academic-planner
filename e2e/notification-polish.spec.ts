import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  completeOnboarding,
  bogotaToday,
  expectNoHorizontalOverflow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/**
 * Notification iconography: the reminder count is a small circle pinned to the "Inicio" icon (a bell from the icon set from
 * 1024 px, never the emoji) and each reminder card has a discreet bell. Only the look: the data is the real
 * `/api/reminders/due` answer, replaced here by a fixed one so that 1, 9 and 12 can be shown at every width.
 */
test.use({ serviceWorkers: 'block' });

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const due = (total: number) => ({
  total,
  reminders: Array.from({ length: Math.min(total, 5) }, (_, i) => ({
    id: ID(i + 1),
    activityId: ID(100 + i),
    remindAt: new Date(Date.now() - 60_000).toISOString(),
    kind: 'AUTO',
    status: 'PENDING',
    offsetMinutes: 1440,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
    activity: {
      id: ID(100 + i),
      periodId: ID(200),
      title: `Parcial número ${i + 1} con un nombre bastante largo para comprobar el ajuste`,
      type: 'EXAM',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      hasTime: true,
    },
    subject: null,
  })),
});

async function dueReturns(page: Page, total: number) {
  await page.route('**/api/reminders/due', (route) =>
    route.fulfill({ json: due(total), headers: { 'cache-control': 'no-store' } }),
  );
}

test('the badge keeps 1, 9 and 12 inside a small circle, the cards use a bell icon, at every width', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page, 'Semestre de prueba', {
    start: bogotaToday(-70),
    end: bogotaToday(120),
  });
  const nav = page.getByRole('navigation', { name: 'Principal' });

  for (const total of [1, 9, 12]) {
    await dueReturns(page, total);
    for (const width of [320, 390, 430, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      const home = nav.getByRole('link', { name: /Inicio/ });
      // the accessible name says it in words; the number is only the visual summary
      await expect(home).toHaveAccessibleName(
        `Inicio ${total} ${total === 1 ? 'recordatorio' : 'recordatorios'}`,
      );
      const badge = nav.locator('[data-reminder-badge]');
      await expect(badge).toContainText(String(total));
      await expect(page.locator('body')).not.toContainText('🔔');
      await expectNoHorizontalOverflow(page);

      const b = (await badge.boundingBox())!;
      const link = (await home.boundingBox())!;
      expect(link.height, `link height at ${width}`).toBeGreaterThanOrEqual(43.5);
      expect(b.height, `badge height at ${width}`).toBeLessThanOrEqual(24);
      // a circle on a phone (two digits stay narrow); from 1024 px it also holds the small bell
      expect(b.width, `badge width at ${width}`).toBeLessThanOrEqual(width < 1024 ? 30 : 56);
      if (width < 1024) {
        // inside the link, and clear of the icon's centre: it sits at a corner, never over the middle of the icon
        expect(b.x + b.width).toBeLessThanOrEqual(link.x + link.width + 0.5);
        const icon = (await home.locator('svg').first().boundingBox())!;
        expect(b.x).toBeGreaterThan(icon.x + icon.width / 2);
      }
    }
  }

  // The card: one small bell per reminder (not the emoji), the words and both buttons are still there.
  await dueReturns(page, 12);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/dashboard');
  const panel = page.getByRole('region', { name: 'Recordatorios' });
  await expect(panel.getByText('Tienes 12 recordatorios')).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(5);
  await expect(panel.getByRole('button', { name: /^Marcar como visto/ })).toHaveCount(5);
  await expect(panel.getByRole('button', { name: 'Marcar todos como vistos' })).toBeVisible();
  for (const svg of await panel.getByRole('listitem').locator('svg').all()) {
    const box = (await svg.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(18);
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
  }
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(700);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
  assertClean();
});
