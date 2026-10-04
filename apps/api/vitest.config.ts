import { defineConfig } from 'vitest/config';
import { getTestDatabaseUrl, loadRootEnv } from './test/testDb.js';

loadRootEnv();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // Workers share one database, so test files run one at a time.
    fileParallelism: false,
    // Everything under test (createPrisma, loadEnv) sees the TEST database as DATABASE_URL.
    env: { DATABASE_URL: getTestDatabaseUrl(), NODE_ENV: 'test' },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
