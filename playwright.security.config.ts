import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ensureTestDatabaseSync, getTestDatabaseUrl, loadRootEnv } from './apps/api/test/testDb';

loadRootEnv();
ensureTestDatabaseSync();

const PORT = 4300;

// The PRODUCTION topology: one origin, the API serves the built web app, with the real security headers (CSP).
// Own port and own stack, so it never competes with the main e2e stack. Stop `npm run dev` first (shared test DB).
export default defineConfig({
  testDir: 'e2e',
  testMatch: /security\.spec\.ts/,
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [
    {
      name: 'security-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: {
    command:
      'npm run build -w @planner/core && npm run build -w @planner/web && npm run serve -w @planner/api',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: getTestDatabaseUrl(),
      NODE_ENV: 'test',
      API_PORT: String(PORT),
      CORS_ORIGIN: `http://localhost:${PORT}`,
      WEB_DIST_DIR: path.resolve('apps/web/dist'),
      LOGIN_RATE_LIMIT_MAX: '1000',
      REGISTER_RATE_LIMIT_MAX: '1000',
      SCHEDULE_IMPORT_RATE_LIMIT_MAX: '1000',
    },
  },
});
