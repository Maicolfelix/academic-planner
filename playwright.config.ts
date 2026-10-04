import { defineConfig, devices } from '@playwright/test';

// Browser verification tool for phases with UI. The permanent E2E suite is built in Phase 17.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Optional: run against an installed browser (e.g. PW_CHANNEL=msedge) when the bundled
    // Chromium cannot be downloaded.
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
    {
      name: 'desktop-1366',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  // Reuses the running stack (npm run dev) or starts it.
  webServer: {
    command: 'npm run dev',
    // Ready only when Vite AND the API behind its proxy both answer.
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
