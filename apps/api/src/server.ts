import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPrisma, pingDatabase } from './db/prisma.js';

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
const app = createApp({
  checkDatabase: () => pingDatabase(prisma),
  corsOrigins: env.CORS_ORIGIN,
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
