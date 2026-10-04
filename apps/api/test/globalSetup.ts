import { prepareTestDatabase } from './testDb.js';

export default async function setup() {
  await prepareTestDatabase();
}
