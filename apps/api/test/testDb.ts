import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PrismaClient } from '../src/db/prisma.js';

const apiDir = fileURLToPath(new URL('..', import.meta.url));

/** Loads the repo-root .env without overriding variables that are already set. */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    /* no .env file (CI injects the variables) */
  }
}

const databaseName = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

/**
 * The only place that decides which database tests may touch. Refuses anything that is not
 * clearly a `*_test` database, or that equals the development DATABASE_URL.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (copy it from .env.example).');
  if (!/^[a-z0-9_]+_test$/.test(databaseName(url))) {
    throw new Error(
      `Refusing to run tests: "${databaseName(url)}" does not look like a *_test database.`,
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('Refusing to run tests: TEST_DATABASE_URL equals DATABASE_URL.');
  }
  return url;
}

/**
 * Playwright starts its web server BEFORE its global setup, and that API needs the test database to answer its health
 * check. On a fresh machine (or after `docker compose down -v`) the database does not exist yet, so the configs call this
 * first: it creates and migrates it in a child process (once per run; workers inherit the flag).
 */
export function ensureTestDatabaseSync(): void {
  if (process.env.PLANNER_TEST_DB_READY) return;
  execFileSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./prepareTestDb.ts', import.meta.url))],
    {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      stdio: 'inherit',
      env: process.env,
    },
  );
  process.env.PLANNER_TEST_DB_READY = '1';
}

/**
 * Browser tests start their OWN stack on fixed ports. If something already listens there (a leftover `npm run dev`, or its
 * `node --watch` watcher reviving the API on the DEVELOPMENT database), the test stack's health check can be answered by that
 * old process and the whole run would write to development data. Fail fast, before anything starts, naming the ports.
 * Once per run (workers inherit the flag).
 */
export function assertPortsFree(ports: readonly number[]): void {
  if (process.env.PLANNER_TEST_PORTS_FREE) return;
  const out = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./probePorts.ts', import.meta.url)),
      ...ports.map(String),
    ],
    { cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8' },
  );
  const busy = out.split(/\r?\n/).filter(Boolean);
  if (busy.length > 0)
    throw new Error(
      `Refusing to start the browser tests: something is already listening on port(s) ${busy.join(', ')}. ` +
        'It may be a leftover dev stack (or its node --watch watcher) wired to the DEVELOPMENT database. ' +
        'Stop the whole process tree (taskkill /PID <npm> /T /F) and check with netstat.',
    );
  process.env.PLANNER_TEST_PORTS_FREE = '1';
}

/** Creates the test database if missing, then applies every migration to it (never the dev DB). */
export async function prepareTestDatabase(): Promise<void> {
  const url = getTestDatabaseUrl();
  const name = databaseName(url);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await client.query(`CREATE DATABASE "${name}"`); // name validated above
  } finally {
    await client.end();
  }

  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

/** Empties every table except Prisma's migration ledger. Guarded: only runs on a *_test database. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = row?.db;
  if (!db || !db.endsWith('_test'))
    throw new Error(`Refusing to truncate "${db}": not a test database.`);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
