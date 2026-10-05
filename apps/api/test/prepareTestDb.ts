import { loadRootEnv, prepareTestDatabase } from './testDb.js';

// Entry point of `ensureTestDatabaseSync`: a separate process so a synchronous caller (a Playwright config) can wait for it.
loadRootEnv();
await prepareTestDatabase();
