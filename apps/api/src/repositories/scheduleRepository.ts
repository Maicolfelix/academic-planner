import type { ScheduleBlockType } from '@planner/core';
import type { Db } from '../db/prisma.js';
import { fromDateOnly } from '../mappers.js';

// Subject (name, color) and the period's days come back in the SAME query as the block: no N+1.
const include = {
  subject: { select: { id: true, name: true, color: true } },
  period: { select: { startDate: true, endDate: true } },
} as const;

export interface BlockCandidateFilter {
  /** Instants delimiting the window (already converted from the user's local days). */
  rangeStart: Date;
  rangeEnd: Date;
  /** First local day of the window: a series only matters while its `until` is on or after it. */
  fromDay: string;
  types?: ScheduleBlockType[];
  periodId?: string;
}

export interface ScheduleCreateData {
  userId: string;
  periodId: string;
  subjectId: string | null;
  title: string;
  type: ScheduleBlockType;
  startAt: Date;
  endAt: Date;
  recurrenceType: 'NONE' | 'WEEKLY';
  recurrenceUntil: Date | null;
}

export type ScheduleUpdateData = Omit<ScheduleCreateData, 'userId' | 'periodId'>;

/** Every query is scoped by userId: a block id alone never reaches data. */
export function createScheduleRepository(prisma: Db) {
  return {
    findOwned: (userId: string, id: string) =>
      prisma.scheduleBlock.findFirst({
        where: { id, userId },
        include,
        relationLoadStrategy: 'join',
      }),

    /**
     * Blocks that COULD appear in the window: a single block when it overlaps it, a weekly series
     * when it has started before the window ends and has not finished before it starts. The exact
     * occurrences are then computed in memory for just that window.
     */
    candidates: (userId: string, f: BlockCandidateFilter) =>
      prisma.scheduleBlock.findMany({
        where: {
          userId,
          ...(f.types && { type: { in: f.types } }),
          ...(f.periodId && { periodId: f.periodId }),
          startAt: { lt: f.rangeEnd },
          OR: [
            { recurrenceType: 'NONE', endAt: { gt: f.rangeStart } },
            { recurrenceType: 'WEEKLY', recurrenceUntil: { gte: fromDateOnly(f.fromDay) } },
          ],
        },
        include,
        relationLoadStrategy: 'join',
        orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      }),

    create: (data: ScheduleCreateData) =>
      prisma.scheduleBlock.create({ data, include, relationLoadStrategy: 'join' }),

    /** `where: { id, userId }` makes ownership part of the write itself (P2025 when it is not yours). */
    update: (userId: string, id: string, data: ScheduleUpdateData) =>
      prisma.scheduleBlock.update({
        where: { id, userId },
        data,
        include,
        relationLoadStrategy: 'join',
      }),

    delete: async (userId: string, id: string) =>
      (await prisma.scheduleBlock.deleteMany({ where: { id, userId } })).count > 0,
  };
}

export type ScheduleRepository = ReturnType<typeof createScheduleRepository>;
