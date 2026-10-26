#!/usr/bin/env node
// Fresh-database validation: proves the artifact works on a COMPLETELY EMPTY PostgreSQL, from nothing, and leaves nothing behind.
//
//   node scripts/fresh-db-validation.mjs                      # builds the images, runs everything, destroys what it created
//   node scripts/fresh-db-validation.mjs --skip-build         # reuse academic-planner:fresh-validation / -migrate:
//   node scripts/fresh-db-validation.mjs --accept-known-drift # accept the ONE reviewed, intentional schema difference
//
// What it does (all inside Docker, nothing touches the development database or any *_test database):
//   1. a throw-away PostgreSQL 17 container on a private network, no published port, a random name and password;
//   2. proves the database is empty, applies ALL migrations with the `migrate` image (the explicit schema step);
//   3. `prisma migrate status` and `prisma migrate diff` against schema.prisma (no drift);
//   4. starts the web image (production mode, one origin) and waits for /api/health;
//   5. the production smoke (scripts/smoke.mjs --full): register, onboarding data, subject, activity, complete, re-login;
//   6. the container checks (argon2, @napi-rs/canvas, tesseract.js + Spanish data, schedule-import route);
//   7. restarts the web AND the database containers and proves the data persisted and the app answers;
//   8. SIGTERM: `docker stop` must end the web process cleanly (exit 0) and fast;
//   9. destroys the containers and the network. No seed, no demo data.
//
// Safety: every name it creates starts with `planner-fresh-`, the database is `planner_fresh_<id>`, and it refuses to run
// unless the connection string points at THAT container. It never reads .env or DATABASE_URL from the environment.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipBuild = process.argv.includes('--skip-build');
const acceptKnownDrift = process.argv.includes('--accept-known-drift');
// The exact output of `prisma migrate diff` for the one INTENTIONAL difference (see the drift step below).
const KNOWN_DRIFT = [
  '[*] Changed the `Evaluation` table',
  '[-] Removed foreign key on columns (activityId, subjectId)',
];
const RUN_IMAGE = 'academic-planner:fresh-validation';
const MIGRATE_IMAGE = 'academic-planner-migrate:fresh-validation';

const id = randomBytes(3).toString('hex');
const names = {
  network: `planner-fresh-net-${id}`,
  db: `planner-fresh-db-${id}`,
  web: `planner-fresh-web-${id}`,
};
const dbName = `planner_fresh_${id}`;
const dbPassword = randomBytes(12).toString('hex');
const databaseUrl = `postgresql://postgres:${dbPassword}@${names.db}:5432/${dbName}`;

// ── guards: this must be unmistakably a throw-away database ──────────────────────────────────────────────────────────
const target = new URL(databaseUrl);
if (
  !target.hostname.startsWith('planner-fresh-db-') ||
  !target.pathname.slice(1).startsWith('planner_fresh_') ||
  (target.port !== '5432' && target.port !== '')
) {
  console.error(
    'Refusing to run: the connection string does not point at the throw-away container.',
  );
  process.exit(2);
}
if (
  /_test$|^academic_planner$/.test(target.pathname.slice(1)) ||
  ['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
  target.port === '5433'
) {
  console.error(
    'Refusing to run: the connection string looks like the development or test database.',
  );
  process.exit(2);
}

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const docker = (args, opts = {}) =>
  spawnSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const dockerOk = (args, opts) => {
  const r = docker(args, opts);
  if (r.status !== 0)
    throw new Error(
      `docker ${args.slice(0, 3).join(' ')} failed (${r.status}): ${(r.stderr || r.stdout).slice(-400)}`,
    );
  return r.stdout.trim();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
const psql = (sql) =>
  dockerOk(['exec', names.db, 'psql', '-U', 'postgres', '-d', dbName, '-At', '-c', sql]);
async function waitFor(label, fn, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(1000);
  }
}

async function main() {
  const migrationDirs = readdirSync(path.join(root, 'apps/api/prisma/migrations')).filter((d) =>
    /^\d{14}_/.test(d),
  );
  console.log(
    `Fresh DB validation (${id}): ${migrationDirs.length} migrations in the repository\n`,
  );

  if (!skipBuild) {
    console.log('Building the images (cached layers make this quick when nothing changed)…');
    dockerOk(['build', '-t', RUN_IMAGE, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    dockerOk(['build', '--target', 'migrate', '-t', MIGRATE_IMAGE, '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  // 1. an empty database in a private network
  dockerOk(['network', 'create', names.network]);
  dockerOk([
    'run',
    '-d',
    '--name',
    names.db,
    '--network',
    names.network,
    '-e',
    `POSTGRES_PASSWORD=${dbPassword}`,
    '-e',
    `POSTGRES_DB=${dbName}`,
    'postgres:17-alpine',
  ]);
  await waitFor(
    'PostgreSQL',
    () => docker(['exec', names.db, 'pg_isready', '-U', 'postgres', '-d', dbName]).status === 0,
  );
  await sleep(1500); // the image restarts once after init
  await waitFor(
    'PostgreSQL (after init)',
    () => docker(['exec', names.db, 'pg_isready', '-U', 'postgres', '-d', dbName]).status === 0,
  );
  const tables = Number(
    psql("select count(*) from information_schema.tables where table_schema = 'public'"),
  );
  record(
    'the database is completely empty before the migrations',
    tables === 0,
    `${tables} tables`,
  );

  // 2. the explicit schema step: ALL migrations from nothing
  const migrate = docker([
    'run',
    '--rm',
    '--network',
    names.network,
    '-e',
    `DATABASE_URL=${databaseUrl}`,
    MIGRATE_IMAGE,
  ]);
  const applied = [...new Set(migrate.stdout.match(/\d{14}_[a-z0-9_]+/g) ?? [])];
  record(
    `migrate deploy applies all ${migrationDirs.length} migrations from an empty database`,
    migrate.status === 0 &&
      applied.length === migrationDirs.length &&
      /successfully applied/i.test(migrate.stdout),
    `exit ${migrate.status}, ${applied.length} applied`,
  );
  if (migrate.status !== 0) console.log(migrate.stdout.slice(-600), migrate.stderr.slice(-600));

  // 3. status and drift
  const inApi = (cmd) =>
    docker([
      'run',
      '--rm',
      '--network',
      names.network,
      '-e',
      `DATABASE_URL=${databaseUrl}`,
      '--entrypoint',
      'sh',
      MIGRATE_IMAGE,
      '-c',
      `cd apps/api && ${cmd}`,
    ]);
  const status = inApi('npx --no-install prisma migrate status');
  record(
    'prisma migrate status: the schema is up to date',
    status.status === 0 && /Database schema is up to date/i.test(status.stdout),
    `exit ${status.status}`,
  );
  const drift = inApi(
    'npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code',
  );
  const driftLines = (drift.stdout.match(/^\s*\[[*+-]\].*$/gm) ?? []).map((l) => l.trim());
  const driftLabel =
    'prisma migrate diff: no drift between the migrated database and schema.prisma';
  if (drift.status === 0 && /No difference detected/i.test(drift.stdout)) {
    record(driftLabel, true);
  } else if (drift.status === 2 && JSON.stringify(driftLines) === JSON.stringify(KNOWN_DRIFT)) {
    // The ONE difference that is intentional: the composite Evaluation -> Activity foreign key is written by hand in the
    // migration (ON DELETE SET NULL ("activityId"), PostgreSQL 15+), which Prisma cannot express in schema.prisma, so a diff
    // always reports it. It needs a maintainer's review, hence it only passes when explicitly accepted.
    record(
      driftLabel,
      acceptKnownDrift,
      `KNOWN, INTENTIONAL drift: ${KNOWN_DRIFT.join(' / ')} (hand-written FK, see data-model.md). ${acceptKnownDrift ? 'Accepted with --accept-known-drift.' : 'Review it, then re-run with --accept-known-drift.'}`,
    );
  } else {
    record(
      driftLabel,
      false,
      `exit ${drift.status}: ${driftLines.join(' / ') || drift.stdout.slice(0, 300)}`,
    );
  }
  const migrationRows = Number(
    psql(
      'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null',
    ),
  );
  record(
    'every migration is recorded as finished',
    migrationRows === migrationDirs.length,
    `${migrationRows} rows`,
  );

  // 4. the web process: production mode, one origin, exactly as a platform would run it
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  dockerOk([
    'run',
    '-d',
    '--name',
    names.web,
    '--network',
    names.network,
    '-p',
    `127.0.0.1:${port}:3000`,
    '-e',
    `DATABASE_URL=${databaseUrl}`,
    '-e',
    `CORS_ORIGIN=${baseUrl}`,
    RUN_IMAGE,
  ]);
  const up = await waitFor(
    'the web process',
    async () => (await fetch(`${baseUrl}/api/health`)).status === 200,
    60_000,
  ).catch(() => false);
  const health = up ? await (await fetch(`${baseUrl}/api/health`)).json() : {};
  record(
    'the production image answers /api/health with the database up',
    up && health.database === 'up',
    JSON.stringify(health),
  );
  // the image's own HEALTHCHECK (it runs every 30 s after a 20 s start period) must turn healthy
  const healthy = await waitFor(
    'the container HEALTHCHECK',
    () => dockerOk(['inspect', '-f', '{{.State.Health.Status}}', names.web]) === 'healthy',
    120_000,
  ).catch(() => false);
  record('the image HEALTHCHECK reports healthy', healthy);
  const noMigrateOnBoot = !/migrat/i.test(
    docker(['logs', names.web]).stdout + docker(['logs', names.web]).stderr,
  );
  record('starting the web process runs no migrations', noMigrateOnBoot);

  // 5. production smoke as an external client (full flow)
  const smoke = spawnSync(process.execPath, ['scripts/smoke.mjs', '--full'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BASE_URL: baseUrl },
  });
  console.log(
    smoke.stdout
      .split('\n')
      .map((l) => `      ${l}`)
      .join('\n'),
  );
  record(
    'production smoke (--full) against the container',
    smoke.status === 0,
    `exit ${smoke.status}`,
  );

  // 6. native modules, OCR and the schedule-import route inside the container
  dockerOk([
    'cp',
    path.join(root, 'scripts/fixtures/ocr-sample.png'),
    `${names.web}:/tmp/ocr-sample.png`,
  ]);
  const check = docker(
    [
      'exec',
      '-i',
      '-e',
      'OCR_FIXTURE=/tmp/ocr-sample.png',
      names.web,
      'node',
      '--input-type=module',
      '-',
    ],
    { input: readFileSync(path.join(root, 'scripts/container-check.mjs'), 'utf8') },
  );
  console.log(
    check.stdout
      .split('\n')
      .map((l) => `      ${l}`)
      .join('\n'),
  );
  record(
    'container checks: argon2, @napi-rs/canvas, tesseract.js + spa data, schedule-import route',
    check.status === 0,
    `exit ${check.status}${check.status ? ' ' + check.stderr.slice(0, 200) : ''}`,
  );

  // 7. persistence across a restart of the web process AND of the database
  const before = {
    users: Number(psql('select count(*) from "User"')),
    done: Number(psql('select count(*) from "Activity" where status = \'COMPLETED\'')),
  };
  dockerOk(['restart', '-t', '10', names.web]);
  dockerOk(['restart', '-t', '10', names.db]);
  await waitFor(
    'PostgreSQL (after restart)',
    () => docker(['exec', names.db, 'pg_isready', '-U', 'postgres', '-d', dbName]).status === 0,
  );
  const back = await waitFor(
    'the web process (after restart)',
    async () => (await fetch(`${baseUrl}/api/health`)).status === 200,
    60_000,
  ).catch(() => false);
  const after = {
    users: Number(psql('select count(*) from "User"')),
    done: Number(psql('select count(*) from "Activity" where status = \'COMPLETED\'')),
  };
  record(
    'the data persisted after restarting the web process and the database',
    back &&
      before.users >= 1 &&
      before.done >= 1 &&
      after.users === before.users &&
      after.done === before.done,
    `users ${before.users}→${after.users}, completed activities ${before.done}→${after.done}`,
  );
  const smoke2 = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BASE_URL: baseUrl },
  });
  record(
    'the app still passes the (minimal) smoke after the restart',
    smoke2.status === 0,
    `exit ${smoke2.status}`,
  );

  // 8. a clean SIGTERM
  const started = Date.now();
  docker(['stop', '-t', '10', names.web]);
  const seconds = (Date.now() - started) / 1000;
  const exit = Number(dockerOk(['inspect', '-f', '{{.State.ExitCode}}', names.web]));
  const logs = docker(['logs', names.web]);
  record(
    'SIGTERM ends the web process cleanly (exit 0, well before the 10 s kill)',
    exit === 0 && seconds < 8,
    `exit ${exit}, ${seconds.toFixed(1)} s`,
  );
  const logText = logs.stdout + logs.stderr;
  const crash =
    /\b(TypeError|ReferenceError|RangeError|SyntaxError|UnhandledPromiseRejection)\b|\bat \S+ \(.+:\d+:\d+\)|ECONNREFUSED|FATAL/.exec(
      logText,
    );
  record(
    'and its logs show no crash, stack trace or connection error',
    crash === null,
    crash ? crash[0] : logText.trim().split('\n').slice(-1)[0],
  );
}

function cleanup() {
  for (const name of [names.web, names.db]) docker(['rm', '-f', '-v', name]);
  docker(['network', 'rm', names.network]);
  const left = docker([
    'ps',
    '-a',
    '--filter',
    `name=planner-fresh-.*-${id}`,
    '--format',
    '{{.Names}}',
  ]).stdout.trim();
  const net = docker([
    'network',
    'ls',
    '--filter',
    `name=${names.network}`,
    '--format',
    '{{.Name}}',
  ]).stdout.trim();
  record(
    'the throw-away database, container and network were destroyed',
    left === '' && net === '',
    left || net || 'nothing left',
  );
}

try {
  await main();
} catch (err) {
  record('the validation ran to the end', false, String(err?.message ?? err));
} finally {
  cleanup();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
