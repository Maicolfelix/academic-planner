import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no .env file: tests needing DATABASE_URL will fail loudly */
}

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
