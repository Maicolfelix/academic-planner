import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The study-level migration, against a database that already holds periods (and the rest of a student's data) written BEFORE
 * it existed: a throwaway database is migrated up to the migration before this one, filled, and only then given this one.
 */
const MIGRATIONS = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const TARGET = '20261012232208_period_study_level';

// Inside the worker DATABASE_URL already IS the *_test database (vitest.config.ts); the scratch database is derived from it.
const url = new URL(process.env.DATABASE_URL!);
const testName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(testName))
  throw new Error(`Refusing to run: "${testName}" is not a *_test database.`);
const name = testName.replace(/_test$/, '_study_level_migration_test');
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
  for (const dir of before) await db.query(migrationSql(dir)); // the schema as it was before the study level
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

const rows = async <T extends pg.QueryResultRow>(sql: string) => (await db.query<T>(sql)).rows;
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

describe('migration 20261012232208_period_study_level', () => {
  it('has no study level columns before it runs', async () => {
    const cols = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'AcademicPeriod'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('studyLevel');
    expect(cols.map((c) => c.column_name)).not.toContain('studyLevelNote');
  });

  it('keeps every existing period as it was, with both new columns NULL, and touches no other row', async () => {
    await db.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt") VALUES
        ('${U1}', 'Ana', 'ana@example.com', 'x', now()),
        ('${U2}', 'Beto', 'beto@example.com', 'x', now());
      INSERT INTO "UserProfile" ("userId", "primaryUse", "programName", "updatedAt") VALUES
        ('${U1}', 'UNIVERSITY_STUDENT', 'Medicina', now()),
        ('${U2}', NULL, NULL, now());
      INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000a1', '${U1}', 'P1', '2026-02-01', '2026-06-01', false, now()),
        ('00000000-0000-4000-8000-0000000000a2', '${U1}', 'P2', '2026-08-03', '2026-11-28', true, now()),
        ('00000000-0000-4000-8000-0000000000b1', '${U2}', 'P1', '2026-08-03', '2026-11-28', true, now());
      INSERT INTO "Subject" (id, "userId", "periodId", name, "nameKey", color, "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000c1', '${U1}', '00000000-0000-4000-8000-0000000000a2', 'Redes', 'redes', '#3B82F6', now());
    `);
    const period = () =>
      rows(
        `SELECT id, "userId", name, "startDate", "endDate", "isCurrent", "createdAt", "updatedAt" FROM "AcademicPeriod" ORDER BY id`,
      );
    const others = async () =>
      JSON.stringify([
        await rows(`SELECT * FROM "User" ORDER BY id`),
        await rows(`SELECT * FROM "UserProfile" ORDER BY "userId"`),
        await rows(`SELECT * FROM "Subject" ORDER BY id`),
      ]);
    const periodsBefore = JSON.stringify(await period());
    const othersBefore = await others();

    await db.query(migrationSql(TARGET));

    expect(JSON.stringify(await period())).toBe(periodsBefore); // every old column of every period, identical
    expect(await others()).toBe(othersBefore);
    const levels = await rows<{ studyLevel: number | null; studyLevelNote: string | null }>(
      `SELECT "studyLevel", "studyLevelNote" FROM "AcademicPeriod"`,
    );
    expect(levels).toHaveLength(3);
    for (const l of levels) expect(l).toEqual({ studyLevel: null, studyLevelNote: null });
  });

  it('enforces the rules in the database from then on', async () => {
    const set = (sets: string) =>
      db.query(
        `UPDATE "AcademicPeriod" SET ${sets} WHERE id = '00000000-0000-4000-8000-0000000000a2'`,
      );
    await expect(set(`"studyLevel" = 0`)).rejects.toThrow(/studyLevel_range/);
    await expect(set(`"studyLevel" = 100`)).rejects.toThrow(/studyLevel_range/);
    await expect(set(`"studyLevelNote" = ''`)).rejects.toThrow(/studyLevelNote_length/);
    await expect(set(`"studyLevelNote" = '${'x'.repeat(41)}'`)).rejects.toThrow(
      /studyLevelNote_length/,
    );
    await expect(set(`"studyLevel" = 4, "studyLevelNote" = 'Cuarto'`)).rejects.toThrow(
      /studyLevel_exclusive/,
    );
    await set(`"studyLevel" = 4`);
    await set(`"studyLevel" = NULL, "studyLevelNote" = 'Internado'`);
    const [p] = await rows<{ studyLevel: number | null; studyLevelNote: string | null }>(
      `SELECT "studyLevel", "studyLevelNote" FROM "AcademicPeriod" WHERE id = '00000000-0000-4000-8000-0000000000a2'`,
    );
    expect(p).toEqual({ studyLevel: null, studyLevelNote: 'Internado' });
  });
});
