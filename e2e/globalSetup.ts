import { createPrisma } from '../apps/api/src/db/prisma';
import { getTestDatabaseUrl, prepareTestDatabase, truncateAll } from '../apps/api/test/testDb';

/** Browser tests run against the *_test database: create it, migrate it, start from empty. */
export default async function globalSetup() {
  await prepareTestDatabase();
  const prisma = createPrisma(getTestDatabaseUrl());
  try {
    await truncateAll(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
