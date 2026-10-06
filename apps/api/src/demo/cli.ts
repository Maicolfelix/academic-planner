import { createPrisma } from '../db/prisma.js';
import { DemoSeedRefused, assertDemoSeedAllowed, describeTarget, seedDemo } from './seedDemo.js';

/**
 * `npm run db:seed:demo -- --allow-demo`. Never started by install, dev, deploy or production startup: it only
 * exists as this explicit command. Exit codes: 0 done, 2 refused by a guard, 1 any other failure.
 */
async function main(): Promise<number> {
  const nodeEnv = process.env.NODE_ENV;
  try {
    assertDemoSeedAllowed({ nodeEnv, argv: process.argv.slice(2) });
  } catch (err) {
    if (err instanceof DemoSeedRefused) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set (copy it from .env.example).');
    return 1;
  }
  // Host, port and database name only: the credentials in the URL are never printed.
  console.log(
    `Demo seed target:\n  NODE_ENV=${nodeEnv ?? '(unset)'}\n  database=${describeTarget(databaseUrl)}`,
  );

  const prisma = createPrisma(databaseUrl);
  try {
    const started = Date.now();
    const s = await seedDemo(prisma, { now: new Date() });
    console.log(
      [
        'Demo seed created.',
        '',
        `User: ${s.email}  (password: see docs/demo.md)`,
        `Period: ${s.period}`,
        `Subjects: ${s.subjects}`,
        `Schedule blocks: ${s.scheduleBlocks}`,
        `Activities: ${s.activities}`,
        `Completed: ${s.completed}`,
        `Reminders: ${s.reminders}`,
        `Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
        '',
        'Sign in normally at /login. Re-run the same command to reset the demo.',
      ].join('\n'),
    );
    return 0;
  } catch (err) {
    console.error('Demo seed failed:', err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
