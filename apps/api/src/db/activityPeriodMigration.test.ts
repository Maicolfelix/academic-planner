import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * F1 migration, against a database that already holds rows written with the OLD schema (activities that all have a
 * subject and no period). A fresh `migrate deploy` would prove nothing about the backfill: here a throwaway database
 * is migrated up to the migration before F1, filled, and only then given the F1 migration.
 */
const MIGRATIONS = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const TARGET = '20261009120000_activity_period_optional_subject';

// Inside the worker DATABASE_URL already IS the *_test database (vitest.config.ts); the scratch database is derived from it.
const url = new URL(process.env.DATABASE_URL!);
const testName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(testName))
  throw new Error(`Refusing to run: "${testName}" is not a *_test database.`);
const name = testName.replace(/_test$/, '_f1_migration_test');
const connection = (db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

const migrationSql = (dir: string) => readFileSync(`${MIGRATIONS}${dir}/migration.sql`, 'utf8');
const before = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name < TARGET)
  .map((d) => d.name)
  .sort();

let db: pg.Client;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: connection('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`); // the name is derived from the validated *_test database
  } finally {
    await admin.end();
  }
  db = new pg.Client({ connectionString: connection(name) });
  await db.connect();
  for (const dir of before) await db.query(migrationSql(dir)); // the schema as it was before F1
});

afterAll(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: connection('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
});

const one = async <T extends pg.QueryResultRow>(sql: string) => (await db.query<T>(sql)).rows;

describe('migration 20261009120000_activity_period_optional_subject', () => {
  it('has the old schema before it runs (subject mandatory, no period on the activity)', async () => {
    const cols = await one<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'Activity'`,
    );
    expect(cols.find((c) => c.column_name === 'periodId')).toBeUndefined();
    expect(cols.find((c) => c.column_name === 'subjectId')?.is_nullable).toBe('NO');
  });

  it('backfills every existing activity with its subject’s period and loses nothing', async () => {
    await db.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt") VALUES
        ('00000000-0000-4000-8000-000000000001', 'Ana', 'ana@example.com', 'x', now()),
        ('00000000-0000-4000-8000-000000000002', 'Beto', 'beto@example.com', 'x', now());
      INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'P1', '2026-08-03', '2026-11-28', false, now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'P2', '2027-02-01', '2027-06-01', true, now()),
        ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000002', 'P1', '2026-08-03', '2026-11-28', true, now());
      INSERT INTO "Subject" (id, "userId", "periodId", name, "nameKey", color, "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Redes', 'redes', '#3B82F6', now()),
        ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'Cálculo', 'calculo', '#3B82F6', now()),
        ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1', 'Física', 'fisica', '#3B82F6', now());
      INSERT INTO "Activity" (id, "userId", "subjectId", title, "dueAt", status, "completedAt", "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'Parcial', '2026-10-20T15:00:00Z', 'PENDING', NULL, now()),
        ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'Taller', '2026-10-21T15:00:00Z', 'COMPLETED', now(), now()),
        ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', 'Quiz', '2027-03-01T15:00:00Z', 'IN_PROGRESS', NULL, now()),
        ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c3', 'Informe', '2026-10-22T15:00:00Z', 'PENDING', NULL, now());
      INSERT INTO "Reminder" (id, "userId", "activityId", "remindAt", kind, "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d1', '2026-10-19T15:00:00Z', 'MANUAL', now());
    `);
    const snapshot = () =>
      one<{ id: string; subjectId: string | null; title: string; status: string; dueAt: string }>(
        `SELECT id, "subjectId", title, status, "dueAt"::text AS "dueAt" FROM "Activity" ORDER BY id`,
      );
    const rowsBefore = await snapshot();
    expect(rowsBefore).toHaveLength(4);

    await db.query(migrationSql(TARGET)); // the F1 migration, applied over live data

    const rowsAfter = await snapshot();
    expect(rowsAfter).toEqual(rowsBefore); // same rows, same subjects, same everything else
    const nulls = await one<{ n: string }>(
      `SELECT count(*) AS n FROM "Activity" WHERE "periodId" IS NULL`,
    );
    expect(Number(nulls[0]!.n)).toBe(0);
    const periods = await one<{ id: string; periodId: string; subjectPeriod: string }>(
      `SELECT a.id, a."periodId", s."periodId" AS "subjectPeriod" FROM "Activity" a JOIN "Subject" s ON s.id = a."subjectId" ORDER BY a.id`,
    );
    expect(periods).toHaveLength(4);
    expect(periods.every((r) => r.periodId === r.subjectPeriod)).toBe(true);
    expect(periods.map((r) => r.periodId.slice(-2))).toEqual(['a1', 'a1', 'a2', 'b1']);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "Reminder"`))[0]!.n)).toBe(
      1,
    );
  });

  it('leaves the schema as designed: period mandatory, subject optional, composite key and indexes in place', async () => {
    const cols = await one<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'Activity'`,
    );
    expect(cols.find((c) => c.column_name === 'periodId')?.is_nullable).toBe('NO');
    expect(cols.find((c) => c.column_name === 'subjectId')?.is_nullable).toBe('YES');

    const fks = await one<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"Activity"'::regclass AND contype = 'f'`,
    );
    const byName = Object.fromEntries(fks.map((f) => [f.conname, f.def]));
    expect(byName['Activity_subjectId_fkey']).toBeUndefined(); // the simple one is gone
    expect(byName['Activity_subjectId_periodId_fkey']).toContain(
      'FOREIGN KEY ("subjectId", "periodId") REFERENCES "Subject"(id, "periodId")',
    );
    expect(byName['Activity_subjectId_periodId_fkey']).not.toMatch(/ON DELETE/); // deleting a subject/period with activities is refused (NO ACTION, no cascade); ON UPDATE CASCADE is Prisma's default, ids never change
    expect(byName['Activity_subjectId_periodId_fkey']).not.toMatch(/MATCH FULL/); // ...and MATCH SIMPLE (a NULL subject is not checked)
    expect(byName['Activity_periodId_fkey']).toContain('REFERENCES "AcademicPeriod"(id)');
    expect(byName['Activity_userId_fkey']).toContain('ON DELETE CASCADE'); // untouched

    const idx = (
      await one<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename IN ('Activity','Subject')`,
      )
    ).map((i) => i.indexname);
    expect(idx).toEqual(
      expect.arrayContaining([
        'Subject_id_periodId_key',
        'Activity_userId_periodId_dueAt_idx',
        'Activity_userId_dueAt_idx',
        'Activity_userId_status_idx',
        'Activity_subjectId_idx',
      ]),
    );
    const check = await one<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = '"Activity"'::regclass AND contype = 'c'`,
    );
    expect(check.map((c) => c.conname)).toContain('Activity_completed_check'); // hand-written CHECK survives
  });

  it('after it, the three invariant cases hold on the migrated database', async () => {
    const insert = (subject: string | null, period: string) =>
      db.query(
        `INSERT INTO "Activity" (id, "userId", "periodId", "subjectId", title, "dueAt", "updatedAt")
         VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', $1, $2, 'N', now(), now())`,
        [period, subject],
      );
    const P1 = '00000000-0000-4000-8000-0000000000a1';
    const P2 = '00000000-0000-4000-8000-0000000000a2';
    const REDES = '00000000-0000-4000-8000-0000000000c1';
    await expect(insert(null, P1)).resolves.toBeTruthy(); // general
    await expect(insert(REDES, P1)).resolves.toBeTruthy(); // subject + its own period
    await expect(insert(REDES, P2)).rejects.toThrow(/Activity_subjectId_periodId_fkey/); // subject + another period
  });
});
