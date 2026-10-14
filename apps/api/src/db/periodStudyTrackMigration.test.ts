import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The period/study migration, against a database that already holds a whole account written BEFORE it existed (a profile that
 * says "Medicina", a current period, subjects, an activity and a schedule block): a throwaway database is migrated up to the
 * migration before this one, filled, and only then given this one. Every old row must come out identical except for the new
 * column (NULL), the old current period must still be current, no study may appear, and the new indexes and the composite
 * foreign key must be enforced by the database itself.
 */
const MIGRATIONS = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const TARGET = '20261013211621_period_study_track';

// Inside the worker DATABASE_URL already IS the *_test database (vitest.config.ts); the scratch database is derived from it.
const url = new URL(process.env.DATABASE_URL!);
const testName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(testName))
  throw new Error(`Refusing to run: "${testName}" is not a *_test database.`);
const name = testName.replace(/_test$/, '_period_study_migration_test');
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
  for (const dir of before) await db.query(migrationSql(dir)); // the schema as it was before the link
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
const P1 = '00000000-0000-4000-8000-0000000000a1';
const T1 = '00000000-0000-4000-8000-0000000000f1';
const T2 = '00000000-0000-4000-8000-0000000000f2';
const T3 = '00000000-0000-4000-8000-0000000000f3';
let n = 0;
const period = (userId: string, studyTrackId: string | null, isCurrent: boolean) => {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return db.query(
    `INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "studyTrackId", "updatedAt")
     VALUES ('${id}', '${userId}', 'P${n}', '2026-08-03', '2026-11-28', ${isCurrent},
             ${studyTrackId === null ? 'NULL' : `'${studyTrackId}'`}, now())`,
  );
};
const track = (id: string, userId: string) =>
  db.query(
    `INSERT INTO "StudyTrack" (id, "userId", name, type, "updatedAt") VALUES ('${id}', '${userId}', 'E', 'UNIVERSITY', now())`,
  );

describe('migration 20261013211621_period_study_track', () => {
  it('has no link between a period and a study before it runs, and the old one-current rule', async () => {
    const cols = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'AcademicPeriod'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('studyTrackId');
    const idx = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'AcademicPeriod' AND indexname LIKE '%current%'`,
    );
    expect(idx.map((i) => i.indexname)).toEqual(['AcademicPeriod_userId_current_key']);
  });

  it('keeps every old row identical (the new column is NULL), keeps the old current period current and creates no study', async () => {
    await db.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt") VALUES
        ('${U1}', 'Ana', 'ana@example.com', 'x', now()),
        ('${U2}', 'Beto', 'beto@example.com', 'x', now());
      INSERT INTO "UserProfile" ("userId", "primaryUse", "programName", "programKey", "onboardingStatus", "updatedAt")
        VALUES ('${U1}', 'UNIVERSITY_STUDENT', 'Medicina', 'medicina', 'COMPLETED', now());
      INSERT INTO "UserProfile" ("userId", "updatedAt") VALUES ('${U2}', now());
      INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "studyLevel", "updatedAt") VALUES
        ('${P1}', '${U1}', 'Actual', '2026-08-03', '2026-11-28', true, 4, now()),
        ('00000000-0000-4000-8000-0000000000a2', '${U1}', 'Antiguo', '2026-02-02', '2026-06-01', false, NULL, now());
      INSERT INTO "Subject" (id, "userId", "periodId", name, "nameKey", color, "educationContext", "updatedAt")
        VALUES ('00000000-0000-4000-8000-0000000000c1', '${U1}', '${P1}', 'Anatomía', 'anatomia', '#3B82F6', 'UNIVERSITY', now()),
               ('00000000-0000-4000-8000-0000000000c2', '${U1}', '${P1}', 'Redes', 'redes', '#EF4444', NULL, now());
      INSERT INTO "Activity" (id, "userId", "periodId", "subjectId", title, type, priority, status, "dueAt", "hasTime", "updatedAt")
        VALUES ('00000000-0000-4000-8000-0000000000d1', '${U1}', '${P1}', '00000000-0000-4000-8000-0000000000c1',
                'Parcial', 'EXAM', 'MEDIUM', 'PENDING', '2026-10-20T15:00:00Z', true, now());
      INSERT INTO "ScheduleBlock" (id, "userId", "periodId", "subjectId", title, type, "startAt", "endAt", "recurrenceType", "recurrenceUntil", "updatedAt")
        VALUES ('00000000-0000-4000-8000-0000000000e1', '${U1}', '${P1}', '00000000-0000-4000-8000-0000000000c2',
                'Clase', 'CLASS', '2026-08-04T13:00:00Z', '2026-08-04T15:00:00Z', 'WEEKLY', '2026-11-24', now());
    `);
    const old = `id, "userId", name, "startDate", "endDate", "isCurrent", "studyLevel", "studyLevelNote", "createdAt", "updatedAt"`;
    const snapshot = async () =>
      JSON.stringify([
        await rows(`SELECT * FROM "User" ORDER BY id`),
        await rows(`SELECT * FROM "UserProfile" ORDER BY "userId"`),
        await rows(`SELECT ${old} FROM "AcademicPeriod" ORDER BY id`),
        await rows(`SELECT * FROM "Subject" ORDER BY id`),
        await rows(`SELECT * FROM "Activity" ORDER BY id`),
        await rows(`SELECT * FROM "ScheduleBlock" ORDER BY id`),
        await rows(`SELECT * FROM "StudyTrack" ORDER BY id`),
      ]);
    const beforeData = await snapshot();

    await db.query(migrationSql(TARGET));

    expect(await snapshot()).toBe(beforeData); // every old column of every row, identical
    // the new column is NULL everywhere and the old current period is STILL current
    const periods = await rows<{ id: string; isCurrent: boolean; studyTrackId: string | null }>(
      `SELECT id, "isCurrent", "studyTrackId" FROM "AcademicPeriod" ORDER BY id`,
    );
    expect(periods.map((p) => p.studyTrackId)).toEqual([null, null]);
    expect(periods.find((p) => p.id === P1)?.isCurrent).toBe(true);
    // nothing was derived from the profile (it says "Medicina"): no study exists
    expect(await rows(`SELECT * FROM "StudyTrack"`)).toEqual([]);
  });

  it('swaps the index: the per-user one is gone and the two per-scope ones exist', async () => {
    const idx = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'AcademicPeriod' AND indexname LIKE '%current%' ORDER BY indexname`,
    );
    expect(idx.map((i) => i.indexname)).toEqual([
      'AcademicPeriod_studyTrackId_current_key',
      'AcademicPeriod_userId_current_untracked_key',
    ]);
  });

  it('a user still cannot have two current periods WITHOUT a study (exactly the old rule for old data)', async () => {
    await expect(period(U1, null, true)).rejects.toThrow(
      /AcademicPeriod_userId_current_untracked_key/,
    );
    await period(U1, null, false); // a second, not current: fine
    await period(U2, null, true); // another user has its own
  });

  it('a general current period and the current periods of several studies coexist; two in one study never do', async () => {
    await track(T1, U1);
    await track(T2, U1);
    await period(U1, T1, true);
    await period(U1, T2, true);
    await expect(period(U1, T1, true)).rejects.toThrow(/AcademicPeriod_studyTrackId_current_key/);
    await period(U1, T1, false); // not current: fine
    const current = await rows<{ studyTrackId: string | null }>(
      `SELECT "studyTrackId" FROM "AcademicPeriod" WHERE "userId" = '${U1}' AND "isCurrent" ORDER BY "studyTrackId" NULLS FIRST`,
    );
    expect(current.map((c) => c.studyTrackId)).toEqual([null, T1, T2]);
  });

  it('moving a current period into an occupied scope is refused by the database too', async () => {
    await expect(
      db.query(`UPDATE "AcademicPeriod" SET "studyTrackId" = '${T1}' WHERE id = '${P1}'`),
    ).rejects.toThrow(/AcademicPeriod_studyTrackId_current_key/);
    await db.query(`UPDATE "AcademicPeriod" SET "isCurrent" = false WHERE id = '${P1}'`);
    await db.query(`UPDATE "AcademicPeriod" SET "studyTrackId" = '${T1}' WHERE id = '${P1}'`); // not current: free
  });

  it('a period can never point at another user’s study (composite foreign key), and NULL is always allowed', async () => {
    await track(T3, U2);
    await expect(period(U1, T3, false)).rejects.toThrow(/AcademicPeriod_studyTrackId_userId_fkey/);
    await expect(
      db.query(`UPDATE "AcademicPeriod" SET "studyTrackId" = '${T3}' WHERE id = '${P1}'`),
    ).rejects.toThrow(/AcademicPeriod_studyTrackId_userId_fkey/);
    await period(U2, T3, true); // its own study: fine
    await period(U1, null, false);
  });

  it('studies are archived, never deleted: one with periods cannot be deleted; a whole user still can', async () => {
    await expect(db.query(`DELETE FROM "StudyTrack" WHERE id = '${T1}'`)).rejects.toThrow(
      /AcademicPeriod_studyTrackId_userId_fkey/,
    );
    // deleting the user removes its studies and its periods in one go (the subjects and the rest are cleared first)
    await db.query(`DELETE FROM "Activity"; DELETE FROM "ScheduleBlock"; DELETE FROM "Subject"`);
    await db.query(`DELETE FROM "User" WHERE id = '${U1}'`);
    expect(await rows(`SELECT 1 FROM "StudyTrack" WHERE "userId" = '${U1}'`)).toEqual([]);
    expect(await rows(`SELECT 1 FROM "AcademicPeriod" WHERE "userId" = '${U1}'`)).toEqual([]);
    expect(
      (await rows(`SELECT 1 FROM "AcademicPeriod" WHERE "userId" = '${U2}'`)).length,
    ).toBeGreaterThan(0);
  });
});
