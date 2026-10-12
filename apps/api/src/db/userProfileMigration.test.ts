import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The UserProfile migration, against a database that already holds users written BEFORE it existed. A fresh
 * `migrate deploy` proves nothing about the backfill: a throwaway database is migrated up to the migration before this one,
 * filled with users and their data, and only then given the profile migration.
 */
const MIGRATIONS = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const TARGET = '20261012202852_user_profile';

// Inside the worker DATABASE_URL already IS the *_test database (vitest.config.ts); the scratch database is derived from it.
const url = new URL(process.env.DATABASE_URL!);
const testName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(testName))
  throw new Error(`Refusing to run: "${testName}" is not a *_test database.`);
const name = testName.replace(/_test$/, '_profile_migration_test');
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
  for (const dir of before) await db.query(migrationSql(dir)); // the schema as it was before profiles
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

describe('migration 20261012202852_user_profile', () => {
  it('has no profile table before it runs', async () => {
    const t = await rows(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'UserProfile'`,
    );
    expect(t).toEqual([]);
  });

  it('gives each existing user exactly one empty NOT_STARTED profile and touches nothing else', async () => {
    await db.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", timezone, "updatedAt") VALUES
        ('00000000-0000-4000-8000-000000000001', 'Ana', 'ana@example.com', 'hash-a', 'America/Bogota', now()),
        ('00000000-0000-4000-8000-000000000002', 'Beto', 'beto@example.com', 'hash-b', 'Asia/Tokyo', now()),
        ('00000000-0000-4000-8000-000000000003', 'Cleo', 'cleo@example.com', 'hash-c', 'America/Bogota', now());
      INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'P1', '2026-08-03', '2026-11-28', true, now());
      INSERT INTO "Subject" (id, "userId", "periodId", name, "nameKey", color, "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Redes', 'redes', '#3B82F6', now());
      INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt") VALUES
        ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000002', 'tok', now() + interval '1 day');
    `);
    const snapshot = async () =>
      JSON.stringify([
        await rows(`SELECT * FROM "User" ORDER BY id`),
        await rows(`SELECT * FROM "AcademicPeriod" ORDER BY id`),
        await rows(`SELECT * FROM "Subject" ORDER BY id`),
        await rows(`SELECT * FROM "Session" ORDER BY id`),
      ]);
    const beforeData = await snapshot();

    await db.query(migrationSql(TARGET));

    const profiles = await rows<{
      userId: string;
      primaryUse: string | null;
      programName: string | null;
      programKey: string | null;
      onboardingStatus: string;
    }>(
      `SELECT "userId", "primaryUse", "programName", "programKey", "onboardingStatus" FROM "UserProfile" ORDER BY "userId"`,
    );
    expect(profiles.map((p) => p.userId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]);
    for (const p of profiles) {
      expect(p).toMatchObject({
        primaryUse: null,
        programName: null,
        programKey: null,
        onboardingStatus: 'NOT_STARTED',
      });
    }
    expect(await snapshot()).toBe(beforeData); // not a column of user data changed
    const orphans = await rows(
      `SELECT u.id FROM "User" u LEFT JOIN "UserProfile" p ON p."userId" = u.id WHERE p."userId" IS NULL`,
    );
    expect(orphans).toEqual([]);
  });

  it('cannot hold a second profile for a user, or a profile for nobody', async () => {
    await expect(
      db.query(
        `INSERT INTO "UserProfile" ("userId", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000001', now())`,
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      db.query(
        `INSERT INTO "UserProfile" ("userId", "updatedAt") VALUES ('00000000-0000-4000-8000-0000000000ff', now())`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('enforces the program rules in the database too', async () => {
    const set = (sets: string) =>
      db.query(
        `UPDATE "UserProfile" SET ${sets} WHERE "userId" = '00000000-0000-4000-8000-000000000001'`,
      );
    await expect(set(`"programKey" = 'medicina'`)).rejects.toThrow(/programKey_needs_name/);
    await expect(set(`"programName" = ''`)).rejects.toThrow(/programName_length/);
    await expect(set(`"programName" = '${'x'.repeat(81)}'`)).rejects.toThrow(/programName_length/);
    await set(`"programName" = 'Medicina', "programKey" = 'medicina'`);
  });

  it('deleting a user removes the profile with it', async () => {
    await db.query(`DELETE FROM "Session" WHERE "userId" = '00000000-0000-4000-8000-000000000002'`);
    await db.query(`DELETE FROM "User" WHERE id = '00000000-0000-4000-8000-000000000002'`);
    const left = await rows<{ userId: string }>(`SELECT "userId" FROM "UserProfile"`);
    expect(left.map((p) => p.userId).sort()).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    ]);
  });
});
