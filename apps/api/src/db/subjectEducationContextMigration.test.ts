import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The education-context migration, against a database that already holds subjects (with activities and schedule blocks)
 * written BEFORE it existed: a throwaway database is migrated up to the migration before this one, filled, and only then
 * given this one. Every old subject must come out with a NULL context and with nothing else changed.
 */
const MIGRATIONS = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const TARGET = '20261013000205_subject_education_context';

// Inside the worker DATABASE_URL already IS the *_test database (vitest.config.ts); the scratch database is derived from it.
const url = new URL(process.env.DATABASE_URL!);
const testName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(testName))
  throw new Error(`Refusing to run: "${testName}" is not a *_test database.`);
const name = testName.replace(/_test$/, '_education_context_migration_test');
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
  for (const dir of before) await db.query(migrationSql(dir)); // the schema as it was before the context
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
const P1 = '00000000-0000-4000-8000-0000000000a1';

describe('migration 20261013000205_subject_education_context', () => {
  it('has no context column before it runs', async () => {
    const cols = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Subject'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('educationContext');
  });

  it('leaves every existing subject NULL, and changes no name, color, relation, activity or schedule block', async () => {
    await db.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt")
        VALUES ('${U1}', 'Ana', 'ana@example.com', 'x', now());
      INSERT INTO "UserProfile" ("userId", "primaryUse", "updatedAt") VALUES ('${U1}', 'UNIVERSITY_STUDENT', now());
      INSERT INTO "AcademicPeriod" (id, "userId", name, "startDate", "endDate", "isCurrent", "updatedAt")
        VALUES ('${P1}', '${U1}', 'P1', '2026-08-03', '2026-11-28', true, now());
      INSERT INTO "Subject" (id, "userId", "periodId", name, "nameKey", professor, color, description, "updatedAt") VALUES
        ('00000000-0000-4000-8000-0000000000c1', '${U1}', '${P1}', 'Anatomía', 'anatomia', 'Dra. Ruiz', '#3B82F6', 'Lab', now()),
        ('00000000-0000-4000-8000-0000000000c2', '${U1}', '${P1}', 'Taller de Escritura', 'taller de escritura', NULL, '#EF4444', NULL, now()),
        ('00000000-0000-4000-8000-0000000000c3', '${U1}', '${P1}', 'Asignatura Experimental 847', 'asignatura experimental 847', NULL, '#10B981', NULL, now());
      INSERT INTO "Activity" (id, "userId", "periodId", "subjectId", title, type, priority, status, "dueAt", "hasTime", "updatedAt")
        VALUES ('00000000-0000-4000-8000-0000000000d1', '${U1}', '${P1}', '00000000-0000-4000-8000-0000000000c1',
                'Parcial', 'EXAM', 'MEDIUM', 'PENDING', '2026-10-20T15:00:00Z', true, now());
      INSERT INTO "ScheduleBlock" (id, "userId", "periodId", "subjectId", title, type, "startAt", "endAt", "recurrenceType", "recurrenceUntil", "updatedAt")
        VALUES ('00000000-0000-4000-8000-0000000000e1', '${U1}', '${P1}', '00000000-0000-4000-8000-0000000000c2',
                'Clase', 'CLASS', '2026-08-04T13:00:00Z', '2026-08-04T15:00:00Z', 'WEEKLY', '2026-11-24', now());
    `);
    const snapshot = async () =>
      JSON.stringify([
        await rows(
          `SELECT id, "userId", "periodId", name, "nameKey", professor, color, description, "createdAt", "updatedAt" FROM "Subject" ORDER BY id`,
        ),
        await rows(`SELECT * FROM "Activity" ORDER BY id`),
        await rows(`SELECT * FROM "ScheduleBlock" ORDER BY id`),
        await rows(`SELECT * FROM "AcademicPeriod" ORDER BY id`),
        await rows(`SELECT * FROM "UserProfile" ORDER BY "userId"`),
        await rows(`SELECT * FROM "User" ORDER BY id`),
      ]);
    const beforeData = await snapshot();

    await db.query(migrationSql(TARGET));

    expect(await snapshot()).toBe(beforeData); // every old column of every row, identical
    const contexts = await rows<{ educationContext: string | null }>(
      `SELECT "educationContext" FROM "Subject" ORDER BY id`,
    );
    expect(contexts).toHaveLength(3);
    // NOT derived from the profile (it says UNIVERSITY_STUDENT) and not from the names
    for (const c of contexts) expect(c.educationContext).toBeNull();
  });

  it('accepts the three values and NULL, and nothing else', async () => {
    const set = (v: string) =>
      db.query(
        `UPDATE "Subject" SET "educationContext" = ${v} WHERE id = '00000000-0000-4000-8000-0000000000c1'`,
      );
    for (const v of [`'UNIVERSITY'`, `'SCHOOL'`, `'OTHER_ACADEMIC'`, 'NULL']) await set(v);
    await expect(set(`'PERSONAL'`)).rejects.toThrow(/invalid input value for enum/);
  });
});
