import type { AutoReminderTime, ReminderStatus } from '@planner/core';
import type { Db } from '../db/prisma.js';

// The activity (and its subject) come back in the SAME query as the reminder: no N+1.
const withActivity = {
  activity: {
    select: {
      id: true,
      title: true,
      type: true,
      dueAt: true,
      hasTime: true,
      status: true,
      subject: { select: { id: true, name: true, color: true } },
    },
  },
} as const;

export interface ReminderListFilter {
  activityId?: string;
  status?: ReminderStatus;
}

/**
 * Every query is scoped by userId: a reminder id alone never reaches data. Accepts the shared client or a
 * transaction's, so the same operations can run on their own or inside an activity's transaction.
 */
export function createReminderRepository(db: Db) {
  return {
    list: (userId: string, f: ReminderListFilter, take: number) =>
      db.reminder.findMany({
        where: {
          userId,
          ...(f.activityId && { activityId: f.activityId }),
          ...(f.status && { status: f.status }),
        },
        orderBy: [{ remindAt: 'asc' }, { createdAt: 'asc' }],
        take,
      }),

    findOwned: (userId: string, id: string) =>
      db.reminder.findFirst({
        where: { id, userId },
        select: { id: true, activityId: true, kind: true },
      }),

    /** Reminders that are due: PENDING, time reached, activity not finished, activity in the given period. */
    listDue: (userId: string, periodId: string, now: Date, take: number) =>
      db.reminder.findMany({
        where: dueWhere(userId, periodId, now),
        include: withActivity,
        relationLoadStrategy: 'join',
        // The ones that have waited longest come first.
        orderBy: [{ remindAt: 'asc' }, { createdAt: 'asc' }],
        take,
      }),

    countDue: (userId: string, periodId: string, now: Date) =>
      db.reminder.count({ where: dueWhere(userId, periodId, now) }),

    createManual: (data: { userId: string; activityId: string; remindAt: Date }) =>
      db.reminder.create({
        data: { ...data, kind: 'MANUAL', status: 'PENDING', offsetMinutes: null },
      }),

    /** Editing a reminder makes it MANUAL (never recomputed again) and arms it again. */
    rewrite: (userId: string, id: string, remindAt: Date) =>
      db.reminder.update({
        where: { id, userId },
        data: { remindAt, kind: 'MANUAL', offsetMinutes: null, status: 'PENDING' },
      }),

    delete: async (userId: string, id: string) =>
      (await db.reminder.deleteMany({ where: { id, userId } })).count > 0,

    // ── Used when an activity changes (always inside its transaction) ─────────────────────────
    /** `skipDuplicates`: the partial unique index (activityId, offsetMinutes) is the last line of defence. */
    createAuto: (userId: string, activityId: string, times: AutoReminderTime[]) =>
      times.length === 0
        ? Promise.resolve({ count: 0 })
        : db.reminder.createMany({
            data: times.map((t) => ({
              userId,
              activityId,
              remindAt: t.remindAt,
              offsetMinutes: t.offsetMinutes,
              kind: 'AUTO' as const,
              status: 'PENDING' as const,
            })),
            skipDuplicates: true,
          }),

    deleteAuto: (activityId: string) =>
      db.reminder.deleteMany({ where: { activityId, kind: 'AUTO' } }),

    /** The activity was finished: what was still waiting is cancelled (kept, for traceability). */
    cancelPending: (activityId: string) =>
      db.reminder.updateMany({
        where: { activityId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      }),

    /** The activity was reopened: manual reminders that completion cancelled return if still in the future. */
    reviveManual: (activityId: string, now: Date) =>
      db.reminder.updateMany({
        where: { activityId, kind: 'MANUAL', status: 'CANCELLED', remindAt: { gt: now } },
        data: { status: 'PENDING' },
      }),

    // ── Marking as seen ───────────────────────────────────────────────────────────────────────
    countOwned: (userId: string, ids: string[]) =>
      db.reminder.count({ where: { userId, id: { in: ids } } }),

    /** Only reminders that are actually due can be marked: a client cannot silence a future one. */
    markShown: async (userId: string, ids: string[], now: Date) =>
      (
        await db.reminder.updateMany({
          where: { userId, id: { in: ids }, status: 'PENDING', remindAt: { lte: now } },
          data: { status: 'SHOWN' },
        })
      ).count,
  };
}

const dueWhere = (userId: string, periodId: string, now: Date) =>
  ({
    userId,
    status: 'PENDING',
    remindAt: { lte: now },
    // A finished activity never shows reminders, even if an inconsistent row existed.
    activity: { status: { not: 'COMPLETED' }, subject: { periodId } },
  }) as const;

export type ReminderRepository = ReturnType<typeof createReminderRepository>;
