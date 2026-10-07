import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export type { PrismaClient };

/** Either the shared client or the client bound to one transaction: repositories accept both. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** `timeout` (ms) bounds the whole transaction, `maxWait` the wait for a connection; Prisma's defaults are 5 s and 2 s. */
export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
}

export type RunInTransaction = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions,
) => Promise<T>;

/** Runs `fn` in one database transaction: it commits only if `fn` finishes, and rolls back if it throws. */
export const transactionRunner =
  (prisma: PrismaClient): RunInTransaction =>
  (fn, options) =>
    prisma.$transaction(fn, options);

/** Resolves true when the database answers a trivial query. */
export async function pingDatabase(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
