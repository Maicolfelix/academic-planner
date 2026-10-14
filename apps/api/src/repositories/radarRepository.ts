import type { Db } from '../db/prisma.js';

/**
 * One read-only query for the Radar and the Attention engine: the user's OPEN activities of ALL the given periods (the current,
 * active ones, decided by the server), with their subject joined (null for a general activity). The Radar classifies them in
 * memory with the core rule, so a single round trip serves all five groups (never one query per category, activity or period).
 */
export function createRadarRepository(prisma: Db) {
  return {
    listOpen: (userId: string, periodIds: readonly string[]) =>
      prisma.activity.findMany({
        where: { userId, periodId: { in: [...periodIds] }, status: { not: 'COMPLETED' } },
        include: { subject: { select: { id: true, name: true, color: true } } },
        relationLoadStrategy: 'join',
        // Soonest deadline first (for OVERDUE: the most overdue first, like the Dashboard).
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      }),
  };
}

export type RadarRepository = ReturnType<typeof createRadarRepository>;
