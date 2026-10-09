import {
  createActivitySchema,
  createSubjectSchema,
  toLocalParts,
  updateActivitySchema,
} from '@planner/core';
import { hashPassword } from '../auth/password.js';
import type { PrismaClient } from '../db/prisma.js';
import { createActivityRepository } from '../repositories/activityRepository.js';
import { createPeriodRepository } from '../repositories/periodRepository.js';
import { createReminderRepository } from '../repositories/reminderRepository.js';
import { createScheduleRepository } from '../repositories/scheduleRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { transactionRunner } from '../db/prisma.js';
import { createActivityService, type Actor } from '../services/activityService.js';
import { createPeriodService } from '../services/periodService.js';
import { createReminderService } from '../services/reminderService.js';
import { createScheduleService } from '../services/scheduleService.js';
import { createSubjectService } from '../services/subjectService.js';
import {
  DEMO_EMAIL,
  DEMO_NAME,
  DEMO_PASSWORD,
  DEMO_TIMEZONE,
  MANUAL_REMINDER_ACTIVITY,
  MANUAL_REMINDER_DAYS_BEFORE,
  MANUAL_REMINDER_TIME,
  buildDemoPlan,
} from './demoPlan.js';

/** The seed only ever runs on purpose, and never in production. */
export class DemoSeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSeedRefused';
  }
}

export const ALLOW_FLAG = '--allow-demo';

/**
 * Two independent locks, both required: `NODE_ENV` must not be production (the flag can NOT override that), and the
 * command line must carry `--allow-demo`. A flag on the command line (rather than an environment variable) behaves
 * the same in cmd, PowerShell and bash, and cannot be left switched on by a forgotten `.env` entry.
 */
export function assertDemoSeedAllowed(opts: { nodeEnv?: string; argv: readonly string[] }): void {
  if ((opts.nodeEnv ?? '').trim().toLowerCase() === 'production') {
    throw new DemoSeedRefused('Demo seed refused: NODE_ENV is "production". It never runs there.');
  }
  if (!opts.argv.includes(ALLOW_FLAG)) {
    throw new DemoSeedRefused(
      `Demo seed is disabled. Run it on purpose, in a non-production environment: npm run db:seed:demo -- ${ALLOW_FLAG}`,
    );
  }
}

/** Where the seed is about to write, without credentials: host, port and database name only. */
export function describeTarget(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    return `${u.hostname}:${u.port || '5432'}/${decodeURIComponent(u.pathname.slice(1))}`;
  } catch {
    return '(unreadable DATABASE_URL)';
  }
}

export interface DemoSummary {
  email: string;
  userId: string;
  period: string;
  subjects: number;
  scheduleBlocks: number;
  activities: number;
  completed: number;
  reminders: number;
}

export interface SeedOptions {
  /** Read ONCE by the caller; every date of the dataset derives from it. */
  now: Date;
  /** Tests give each parallel browser project its own demo user; the CLI always uses the default. */
  email?: string;
}

/**
 * Removes the demo user's own data, in foreign-key order, and nothing else: every statement is scoped to that one
 * user id. Reminders go with their activities (ON DELETE CASCADE). Other users' rows and sessions are untouched.
 */
async function clearDemoData(prisma: PrismaClient, userId: string) {
  await prisma.$transaction([
    prisma.activity.deleteMany({ where: { userId } }),
    prisma.scheduleBlock.deleteMany({ where: { userId } }),
    prisma.subject.deleteMany({ where: { userId } }),
    prisma.academicPeriod.deleteMany({ where: { userId } }),
    // A reset invalidates the demo browser's session on purpose: it must sign in again to a consistent state.
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

/** Deletes the demo user itself (cascade removes everything it owns). Used by tests to leave no trace. */
export async function deleteDemoUser(prisma: PrismaClient, email = DEMO_EMAIL) {
  await prisma.user.deleteMany({ where: { email } });
}

/**
 * Creates (or regenerates) the demo student. Idempotent: the user is found by its fixed e-mail and keeps the same id;
 * its previous data is cleared and rebuilt, so running it twice gives the same dataset. Everything is created through
 * the real services (automatic reminders, schedule validation, completion rules); nothing derived is stored.
 */
export async function seedDemo(prisma: PrismaClient, opts: SeedOptions): Promise<DemoSummary> {
  const { now } = opts;
  const email = opts.email ?? DEMO_EMAIL;
  const plan = buildDemoPlan(now, DEMO_TIMEZONE);

  await prisma.$queryRaw`SELECT 1`; // fail early, and clearly, when the database is not reachable

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: DEMO_NAME, passwordHash, timezone: DEMO_TIMEZONE },
    update: { name: DEMO_NAME, passwordHash, timezone: DEMO_TIMEZONE },
  });
  await clearDemoData(prisma, user.id);

  // One mutable clock for all services: each call states the moment it simulates (e.g. "registered two days ago").
  let current = now;
  const clock = () => current;
  const actor: Actor = { id: user.id, timezone: DEMO_TIMEZONE };
  const runInTransaction = transactionRunner(prisma);
  const periodRepo = createPeriodRepository(prisma);
  const subjectRepo = createSubjectRepository(prisma);
  const activityRepo = createActivityRepository(prisma);
  const periods = createPeriodService(periodRepo);
  const subjects = createSubjectService(subjectRepo, periodRepo);
  const schedule = createScheduleService(
    createScheduleRepository(prisma),
    periodRepo,
    subjectRepo,
    clock,
  );
  const activities = createActivityService(
    activityRepo,
    subjectRepo,
    periodRepo,
    clock,
    runInTransaction,
  );
  const reminders = createReminderService(
    createReminderRepository(prisma),
    activityRepo,
    periodRepo,
    runInTransaction,
    clock,
  );

  const period = await periods.create(user.id, { ...plan.period, isCurrent: true });

  const subjectIds = new Map<string, string>();
  for (const s of plan.subjects) {
    const created = await subjects.create(
      user.id,
      createSubjectSchema.parse({
        periodId: period.id,
        name: s.name,
        color: s.color,
        professor: s.professor,
        description: s.description,
      }),
    );
    subjectIds.set(s.name, created.id);
  }

  for (const c of plan.classes) {
    await schedule.create(actor, {
      type: 'CLASS',
      subjectId: subjectIds.get(c.subject)!,
      periodId: period.id,
      title: c.title,
      date: c.date,
      startTime: c.startTime,
      endTime: c.endTime,
      recurrence: { frequency: 'WEEKLY', until: c.until },
    });
  }

  const activityIds = new Map<string, string>();
  for (const a of plan.activities) {
    // Registered in the past, so the automatic reminders that already fell due are the honest result of the real rule.
    current = a.createdAt;
    const created = await activities.create(
      actor,
      createActivitySchema.parse({
        subjectId: subjectIds.get(a.subject)!,
        title: a.title,
        description: a.description,
        type: a.type,
        priority: a.priority,
        dueDate: a.dueDate,
        dueTime: a.dueTime,
      }),
    );
    activityIds.set(a.title, created.id);
    if (a.status !== 'COMPLETED' && a.dueAt.getTime() <= now.getTime()) {
      // An overdue activity: its reminders fired long ago and the student has seen them (otherwise the panel would
      // repeat "venció hace 9 días" once per reminder). Marked through the real "shown" rule, not written by hand.
      current = now;
      const fired = await reminders.list(actor, { activityId: created.id });
      if (fired.length)
        await reminders.markShown(
          actor,
          fired.map((r) => r.id),
        );
    }
    if (a.status !== 'PENDING') {
      // Finished (or started) at its own moment: completedAt comes from the rule, never from a typed-in value.
      current = a.completedAt ?? now;
      await activities.update(actor, created.id, updateActivitySchema.parse({ status: a.status }));
    }
  }

  current = now;
  const target = plan.activities.find((a) => a.title === MANUAL_REMINDER_ACTIVITY)!;
  const remindOn = toLocalParts(
    new Date(target.dueAt.getTime() - MANUAL_REMINDER_DAYS_BEFORE * 86_400_000),
    DEMO_TIMEZONE,
  ).date;
  await reminders.create(actor, {
    activityId: activityIds.get(MANUAL_REMINDER_ACTIVITY)!,
    remindDate: remindOn,
    remindTime: MANUAL_REMINDER_TIME,
  });

  const [blocks, activityCount, completed, reminderCount] = await Promise.all([
    prisma.scheduleBlock.count({ where: { userId: user.id } }),
    prisma.activity.count({ where: { userId: user.id } }),
    prisma.activity.count({ where: { userId: user.id, status: 'COMPLETED' } }),
    prisma.reminder.count({ where: { userId: user.id } }),
  ]);
  return {
    email,
    userId: user.id,
    period: period.name,
    subjects: subjectIds.size,
    scheduleBlocks: blocks,
    activities: activityCount,
    completed,
    reminders: reminderCount,
  };
}
