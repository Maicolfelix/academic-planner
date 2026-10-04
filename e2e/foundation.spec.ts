import { expect, test } from '@playwright/test';

test('frontend renders live /api/health data from the backend', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  const healthResponse = page.waitForResponse((r) => r.url().endsWith('/api/health'));
  await page.goto('/status');

  expect((await healthResponse).status()).toBe(200);
  const health = page.getByTestId('health');
  await expect(health).toContainText('Operativa');
  await expect(health).toContainText('Conectada');
  expect(consoleErrors).toEqual([]);
});

test('shows a clear error when the API is unreachable', async ({ page }) => {
  await page.route('**/api/health', (route) => route.abort());
  await page.goto('/status');
  await expect(page.getByRole('alert')).toContainText('No se pudo conectar');
});
