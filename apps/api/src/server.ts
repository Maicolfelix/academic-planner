import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPrisma, pingDatabase } from './db/prisma.js';

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
const app = createApp({
  prisma,
  checkDatabase: () => pingDatabase(prisma),
  corsOrigins: env.CORS_ORIGIN,
  secureCookies: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
  webDistDir: env.WEB_DIST_DIR,
  rateLimits: { loginMax: env.LOGIN_RATE_LIMIT_MAX, registerMax: env.REGISTER_RATE_LIMIT_MAX },
  scheduleImport: { limit: env.SCHEDULE_IMPORT_RATE_LIMIT_MAX },
});

const server = app.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
