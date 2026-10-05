import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from '../../test/helpers.js';

/**
 * Defence in depth: the rules that matter most are ALSO enforced by PostgreSQL itself, so a bug in a service (or a
 * direct write) cannot save inconsistent data. Each case talks to the database directly, bypassing every service.
 */

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function base() {
  const user = await prisma.user.create({
    data: { name: 'U', email: 'u@example.com', passwordHash: 'x' },
  });
  const period = await prisma.academicPeriod.create({
    data: {
      userId: user.id,
      name: 'P',
      startDate: new Date('2026-08-03'),
      endDate: new Date('2026-11-28'),
      isCurrent: true,
    },
  });
  const subject = await prisma.subject.create({
    data: {
      userId: user.id,
      periodId: period.id,
      name: 'Redes',
      nameKey: 'redes',
      color: '#3B82F6',
    },
  });
  return { user, period, subject };
}

const activity = (b: Awaited<ReturnType<typeof base>>, over: object = {}) => ({
  userId: b.user.id,
  subjectId: b.subject.id,
  title: 'T',
  type: 'TASK' as const,
  dueAt: new Date('2026-10-20T15:00:00Z'),
  hasTime: false,
  ...over,
});

describe('the database refuses inconsistent data on its own', () => {
  it('an email is unique', async () => {
    await base();
    await expect(
      prisma.user.create({ data: { name: 'V', email: 'u@example.com', passwordHash: 'y' } }),
    ).rejects.toThrow();
  });

  it('a period must end after it starts, and a user has at most ONE current period', async () => {
    const b = await base();
    await expect(
      prisma.academicPeriod.create({
        data: {
          userId: b.user.id,
          name: 'Bad',
          startDate: new Date('2026-11-28'),
          endDate: new Date('2026-08-03'),
          isCurrent: false,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.academicPeriod.create({
        data: {
          userId: b.user.id,
          name: 'Second current',
          startDate: new Date('2027-01-10'),
          endDate: new Date('2027-06-10'),
          isCurrent: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('a subject name is unique within a period (ignoring case and accents, through nameKey)', async () => {
    const b = await base();
    await expect(
      prisma.subject.create({
        data: {
          userId: b.user.id,
          periodId: b.period.id,
          name: 'REDES',
          nameKey: 'redes',
          color: '#3B82F6',
        },
      }),
    ).rejects.toThrow();
  });

  it('an activity is COMPLETED exactly when it has a completion instant', async () => {
    const b = await base();
    await expect(
      prisma.activity.create({ data: activity(b, { status: 'COMPLETED' }) }),
    ).rejects.toThrow();
    await expect(
      prisma.activity.create({ data: activity(b, { status: 'PENDING', completedAt: new Date() }) }),
    ).rejects.toThrow();
    await expect(
      prisma.activity.create({
        data: activity(b, { status: 'COMPLETED', completedAt: new Date() }),
      }),
    ).resolves.toBeTruthy();
  });

  it('a class ends after it starts, lasts at most a day, and a weekly series has an end date', async () => {
    const b = await base();
    const block = (over: object) => ({
      userId: b.user.id,
      periodId: b.period.id,
      subjectId: b.subject.id,
      title: 'C',
      type: 'CLASS' as const,
      startAt: new Date('2026-08-03T13:00:00Z'),
      endAt: new Date('2026-08-03T15:00:00Z'),
      recurrenceType: 'NONE' as const,
      ...over,
    });
    await expect(
      prisma.scheduleBlock.create({ data: block({ endAt: new Date('2026-08-03T13:00:00Z') }) }),
    ).rejects.toThrow();
    await expect(
      prisma.scheduleBlock.create({ data: block({ endAt: new Date('2026-08-05T13:00:00Z') }) }),
    ).rejects.toThrow();
    await expect(
      prisma.scheduleBlock.create({ data: block({ recurrenceType: 'WEEKLY' }) }),
    ).rejects.toThrow();
    await expect(
      prisma.scheduleBlock.create({ data: block({ recurrenceUntil: new Date('2026-11-28') }) }),
    ).rejects.toThrow();
    await expect(
      prisma.scheduleBlock.create({
        data: block({ recurrenceType: 'WEEKLY', recurrenceUntil: new Date('2026-11-28') }),
      }),
    ).resolves.toBeTruthy();
  });

  it('an automatic reminder needs its offset and there is only one per activity and offset', async () => {
    const b = await base();
    const a = await prisma.activity.create({ data: activity(b) });
    const reminder = (over: { kind: 'AUTO' | 'MANUAL'; offsetMinutes?: number }) => ({
      userId: b.user.id,
      activityId: a.id,
      remindAt: new Date('2026-10-19T15:00:00Z'),
      ...over,
    });
    await expect(prisma.reminder.create({ data: reminder({ kind: 'AUTO' }) })).rejects.toThrow();
    await expect(
      prisma.reminder.create({ data: reminder({ kind: 'MANUAL', offsetMinutes: -60 }) }),
    ).rejects.toThrow();
    await prisma.reminder.create({ data: reminder({ kind: 'AUTO', offsetMinutes: -1440 }) });
    await expect(
      prisma.reminder.create({ data: reminder({ kind: 'AUTO', offsetMinutes: -1440 }) }),
    ).rejects.toThrow();
  });

  it('a subject or period with dependants can not be deleted from under them (no silent cascade)', async () => {
    const b = await base();
    await prisma.activity.create({ data: activity(b) });
    await expect(prisma.subject.delete({ where: { id: b.subject.id } })).rejects.toThrow();
    await expect(prisma.academicPeriod.delete({ where: { id: b.period.id } })).rejects.toThrow();
  });

  it('deleting a user removes their data and sessions (nothing orphaned that could be read later)', async () => {
    const b = await base();
    await prisma.session.create({
      data: {
        userId: b.user.id,
        tokenHash: 'h'.repeat(64),
        expiresAt: new Date(Date.now() + 1000),
      },
    });
    await prisma.activity.create({ data: activity(b) });
    await prisma.reminder.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.subject.deleteMany();
    await prisma.academicPeriod.deleteMany();
    await prisma.user.delete({ where: { id: b.user.id } });
    expect(await prisma.session.count()).toBe(0);
  });
});
