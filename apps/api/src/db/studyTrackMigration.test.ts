import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The study-track migration, against a database that already holds a whole account (profile, period, subjects, an activity and
 * a schedule block) written BEFORE it existed: a throwaway database is migrated up to the migration before this one, filled,
 * and only then given this one. It must add an empty table and change nothing else, and the invariants it declares must be
 * enforced by the database itself.
 */
const MIGRATIONS = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const TARGET = '20261013204208_study_track';

// Inside the worker DATABASE_URL already IS the *_test database (vitest.config.ts); the scratch database is derived from it.
const url = new URL(process.env.DATABASE_URL!);
const testName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(testName))
  throw new Error(`Refusing to run: "${testName}" is not a *_test database.`);
const name = testName.replace(/_test$/, '_study_track_migration_test');
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
  for (const dir of before) await db.query(migrationSql(dir)); // the schema as it was before the tracks
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

const track = (id: string, userId: string, over: Record<string, string> = {}) => {
  const v = {
    name: `'Medicina'`,
    type: `'UNIVERSITY'`,
    programKey: 'NULL',
    isPrimary: 'false',
    status: `'ACTIVE'`,
    ...over,
  };
  return db.query(
    `INSERT INTO "StudyTrack" (id, "userId", name, type, "programKey", "isPrimary", status, "updatedAt")
     VALUES ('${id}', '${userId}', ${v.name}, ${v.type}, ${v.programKey}, ${v.isPrimary}, ${v.status}, now())`,
  );
};

describe('migration 20261013204208_study_track', () => {
  it('has no study table before it runs', async () => {
    const t = await rows<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(t.map((x) => x.tablename)).not.toContain('StudyTrack');
  });

  it('changes nothing that already exists and creates NO study for anybody (zero tracks, whatever the profile says)', async () => {
    await db.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt") VALUES
        ('${U1}', 'Ana', 'ana@example.com', 'x', now()),
        ('${U2}', 'Beto', 'beto@example.com', 'x', now());
      INSERT INTO "UserProfile" ("userId", "primaryUse", "programName", "programKey", "onboardingStatus", "updatedAt")
        VALUES ('${U1}', 'UNIVERSITY_STUDENT', 'Medicina', 'medicina', 'COMPLETED', now());
      INSERT INTO "UserProfile" ("userId", "updatedAt") VALUES ('${U2}', now());
      INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "studyLevel", "updatedAt")
        VALUES ('${P1}', '${U1}', 'P1', '2026-08-03', '2026-11-28', true, 4, now());
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
    const snapshot = async () =>
      JSON.stringify([
        await rows(`SELECT * FROM "User" ORDER BY id`),
        await rows(`SELECT * FROM "UserProfile" ORDER BY "userId"`),
        await rows(`SELECT * FROM "AcademicPeriod" ORDER BY id`),
        await rows(`SELECT * FROM "Subject" ORDER BY id`),
        await rows(`SELECT * FROM "Activity" ORDER BY id`),
        await rows(`SELECT * FROM "ScheduleBlock" ORDER BY id`),
      ]);
    const beforeData = await snapshot();

    await db.query(migrationSql(TARGET));

    expect(await snapshot()).toBe(beforeData); // every column of every row, identical
    // ZERO tracks: the profile of the first user says "Medicina" and nothing was derived from it
    expect(await rows(`SELECT * FROM "StudyTrack"`)).toEqual([]);
  });

  it('the period table gained nothing (no link to a study yet)', async () => {
    const cols = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'AcademicPeriod'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('studyTrackId');
    // and the one-current-period-per-user index is still the only rule about the current period
    const idx = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'AcademicPeriod' AND indexname LIKE '%current%'`,
    );
    expect(idx.map((i) => i.indexname)).toEqual(['AcademicPeriod_userId_current_key']);
  });

  it('accepts the three types and the two statuses, and nothing else', async () => {
    await track(T1, U1, { type: `'UNIVERSITY'` });
    await track(T2, U1, { type: `'SCHOOL'`, status: `'ARCHIVED'` });
    await track(T3, U1, { type: `'OTHER_ACADEMIC'` });
    await expect(
      track('00000000-0000-4000-8000-0000000000f9', U1, { type: `'PERSONAL'` }),
    ).rejects.toThrow(/invalid input value for enum/);
    await expect(
      track('00000000-0000-4000-8000-0000000000f9', U1, { status: `'DELETED'` }),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it('at most ONE primary per user (zero is fine, and another user has its own)', async () => {
    await db.query(`UPDATE "StudyTrack" SET "isPrimary" = true WHERE id = '${T1}'`);
    await expect(
      db.query(`UPDATE "StudyTrack" SET "isPrimary" = true WHERE id = '${T3}'`),
    ).rejects.toThrow(/StudyTrack_userId_primary_key/);
    await track('00000000-0000-4000-8000-0000000000f4', U2, { isPrimary: 'true' }); // another user
    // two non-primary ones are fine, and clearing the primary leaves zero
    await db.query(`UPDATE "StudyTrack" SET "isPrimary" = false WHERE "userId" = '${U1}'`);
    expect(
      await rows(`SELECT id FROM "StudyTrack" WHERE "userId" = '${U1}' AND "isPrimary"`),
    ).toEqual([]);
  });

  it('a primary study must be ACTIVE (an archived one can never be it)', async () => {
    await expect(
      db.query(`UPDATE "StudyTrack" SET "isPrimary" = true WHERE id = '${T2}'`),
    ).rejects.toThrow(/StudyTrack_primary_active_check/);
    await expect(
      track('00000000-0000-4000-8000-0000000000f5', U1, {
        isPrimary: 'true',
        status: `'ARCHIVED'`,
      }),
    ).rejects.toThrow(/StudyTrack_primary_active_check/);
  });

  it('the name is 1..80 characters and trimmed; a key is a short slug', async () => {
    const id = '00000000-0000-4000-8000-0000000000f6';
    for (const bad of [`''`, `'  '`, `' Medicina'`, `'Medicina '`, `'${'x'.repeat(81)}'`]) {
      await expect(track(id, U1, { name: bad }), bad).rejects.toThrow(/StudyTrack_name_check/);
    }
    await track(id, U1, { name: `'${'x'.repeat(80)}'` });
    await expect(
      track('00000000-0000-4000-8000-0000000000f7', U1, { programKey: `''` }),
    ).rejects.toThrow(/StudyTrack_programKey_length_check/);
    await expect(
      track('00000000-0000-4000-8000-0000000000f7', U1, { programKey: `'${'k'.repeat(61)}'` }),
    ).rejects.toThrow(/StudyTrack_programKey_length_check/);
    await track('00000000-0000-4000-8000-0000000000f7', U1, { programKey: `'medicina'` });
  });

  it('(id, userId) is a unique key: the target a composite foreign key from a period will use later', async () => {
    const idx = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'StudyTrack' AND indexname = 'StudyTrack_id_userId_key'`,
    );
    expect(idx[0]?.indexdef).toMatch(/UNIQUE INDEX .* \(id, "userId"\)/);
    // it really is usable as a foreign-key target, and it refuses a row that points at another user's track
    await db.query(`CREATE TABLE probe (id uuid, "userId" uuid, "studyTrackId" uuid,
      FOREIGN KEY ("studyTrackId", "userId") REFERENCES "StudyTrack" (id, "userId"))`);
    await db.query(`INSERT INTO probe VALUES (gen_random_uuid(), '${U1}', '${T1}')`);
    await expect(
      db.query(`INSERT INTO probe VALUES (gen_random_uuid(), '${U2}', '${T1}')`),
    ).rejects.toThrow(/foreign key/);
    await db.query(`DROP TABLE probe`);
  });

  it("deleting a user deletes its studies and nobody else's", async () => {
    const count = async (u: string) =>
      Number(
        (
          await rows<{ n: string }>(
            `SELECT count(*) AS n FROM "StudyTrack" WHERE "userId" = '${u}'`,
          )
        )[0]!.n,
      );
    expect(await count(U1)).toBeGreaterThan(0);
    expect(await count(U2)).toBe(1);
    await db.query(
      `DELETE FROM "Activity"; DELETE FROM "ScheduleBlock"; DELETE FROM "Subject"; DELETE FROM "AcademicPeriod"`,
    );
    await db.query(`DELETE FROM "User" WHERE id = '${U1}'`);
    expect(await count(U1)).toBe(0);
    expect(await count(U2)).toBe(1);
  });
});
