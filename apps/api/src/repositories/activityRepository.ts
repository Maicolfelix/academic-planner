import type { ActivityPriority, ActivityStatus, ActivityType } from '@planner/core';
import type { PrismaClient } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface ActivityFilters {
  subjectId?: string;
  /** Derived through the subject: activities do not store their period. */
  periodId?: string;
  status?: ActivityStatus;
  priority?: ActivityPriority;
  type?: ActivityType;
  /** Inclusive bounds on dueAt (already converted from the user's local days). */
  dueFrom?: Date;
  dueTo?: Date;
  /** true: dueAt < now AND not completed. false: the complement. */
  overdue?: { now: Date; value: boolean };
}

export interface ActivityCreateData {
  userId: string;
  subjectId: string;
  title: string;
  description: string | null;
  type: ActivityType;
  priority: ActivityPriority;
  dueAt: Date;
  hasTime: boolean;
}

export interface ActivityUpdateData {
  subjectId?: string;
  title?: string;
  description?: string | null;
  type?: ActivityType;
  priority?: ActivityPriority;
  status?: ActivityStatus;
  dueAt?: Date;
  hasTime?: boolean;
  completedAt?: Date | null;
}

/** Every query is scoped by userId: an activity id alone never reaches data. */
export function createActivityRepository(prisma: PrismaClient) {
  return {
    list(userId: string, f: ActivityFilters = {}) {
      const and: Prisma.ActivityWhereInput[] = [];
      if (f.dueFrom) and.push({ dueAt: { gte: f.dueFrom } });
      if (f.dueTo) and.push({ dueAt: { lte: f.dueTo } });
      if (f.overdue) {
        const { now, value } = f.overdue;
        and.push(
          value
            ? { dueAt: { lt: now }, status: { not: 'COMPLETED' } }
            : { OR: [{ dueAt: { gte: now } }, { status: 'COMPLETED' }] },
        );
      }
      return prisma.activity.findMany({
        where: {
          userId,
          ...(f.subjectId && { subjectId: f.subjectId }),
          ...(f.periodId && { subject: { periodId: f.periodId } }),
          ...(f.status && { status: f.status }),
          ...(f.priority && { priority: f.priority }),
          ...(f.type && { type: f.type }),
          ...(and.length > 0 && { AND: and }),
        },
        // Soonest deadline first; createdAt keeps the order stable for equal deadlines.
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      });
    },

    findOwned: (userId: string, id: string) => prisma.activity.findFirst({ where: { id, userId } }),

    create: (data: ActivityCreateData) => prisma.activity.create({ data }),

    /** `where: { id, userId }` makes ownership part of the write itself (P2025 when it is not yours). */
    update: (userId: string, id: string, data: ActivityUpdateData) =>
      prisma.activity.update({ where: { id, userId }, data }),

    delete: async (userId: string, id: string) =>
      (await prisma.activity.deleteMany({ where: { id, userId } })).count > 0,
  };
}

export type ActivityRepository = ReturnType<typeof createActivityRepository>;
