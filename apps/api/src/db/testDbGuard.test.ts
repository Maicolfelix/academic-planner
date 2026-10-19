import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from './prisma.js';
import { assertPortsFree, getTestDatabaseUrl, truncateAll } from '../../test/testDb.js';

/**
 * The guards that keep tests (Vitest and Playwright) away from the DEVELOPMENT database: only a clearly named `*_test` database
 * is accepted, truncation re-checks the name it is really connected to, and the browser tests refuse to start while something
 * (a leftover dev stack or its watcher) already listens on their ports.
 */
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('getTestDatabaseUrl', () => {
  it('refuses a missing URL, a database not named *_test and the development URL', () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => getTestDatabaseUrl()).toThrow(/not set/);
    for (const name of [
      'academic_planner',
      'planner_test_backup',
      'test',
      'Planner_TEST',
      'x-test',
    ]) {
      process.env.TEST_DATABASE_URL = `postgresql://u:p@localhost:5433/${name}`;
      expect(() => getTestDatabaseUrl(), name).toThrow(/does not look like a \*_test database/);
    }
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@localhost:5433/academic_planner_test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    expect(() => getTestDatabaseUrl()).toThrow(/equals DATABASE_URL/);
  });

  it('accepts a *_test database different from the development one', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@localhost:5433/academic_planner_test';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5433/academic_planner';
    expect(getTestDatabaseUrl()).toContain('academic_planner_test');
  });
});

describe('truncateAll', () => {
  const fake = (db: string) => {
    const calls: string[] = [];
    const prisma = {
      $queryRaw: async () => [{ db }],
      $executeRawUnsafe: async (sql: string) => {
        calls.push(sql);
      },
    } as unknown as PrismaClient;
    return { prisma, calls };
  };

  it('refuses to empty a database that is not a *_test one, whatever the URL said', async () => {
    const { prisma, calls } = fake('academic_planner');
    await expect(truncateAll(prisma)).rejects.toThrow(/not a test database/);
    expect(calls).toEqual([]);
  });
});

describe('assertPortsFree', () => {
  it('fails fast, naming the port, when something already listens on it', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      delete process.env.PLANNER_TEST_PORTS_FREE;
      expect(() => assertPortsFree([port])).toThrow(new RegExp(`port\\(s\\) ${port}`));
      expect(process.env.PLANNER_TEST_PORTS_FREE).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('passes when the ports are free, and remembers it for the workers', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    delete process.env.PLANNER_TEST_PORTS_FREE;
    expect(() => assertPortsFree([port])).not.toThrow();
    expect(process.env.PLANNER_TEST_PORTS_FREE).toBe('1');
  });
});
