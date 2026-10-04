import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env on its own. Missing file is fine (CI/production inject env).
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no .env file */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
