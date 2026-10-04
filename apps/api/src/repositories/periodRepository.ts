import type { PrismaClient } from '../db/prisma.js';
import { fromDateOnly } from '../mappers.js';

export interface PeriodData {
  name?: string;
  startDate?: string;
  endDate?: string;
}

const dates = (d: PeriodData) => ({
  ...(d.name !== undefined && { name: d.name }),
  ...(d.startDate !== undefined && { startDate: fromDateOnly(d.startDate) }),
  ...(d.endDate !== undefined && { endDate: fromDateOnly(d.endDate) }),
});

/** Every query is scoped by userId: a period id alone never reaches data. */
export function createPeriodRepository(prisma: PrismaClient) {
  return {
    list: (userId: string) =>
      prisma.academicPeriod.findMany({
        where: { userId },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      }),

    findOwned: (userId: string, id: string) =>
      prisma.academicPeriod.findFirst({ where: { id, userId } }),

    hasCurrent: async (userId: string) =>
      (await prisma.academicPeriod.count({ where: { userId, isCurrent: true } })) > 0,

    /** Un-marking the previous current period and creating the new one happen in one transaction. */
    create: (userId: string, data: Required<PeriodData>, makeCurrent: boolean) =>
      prisma.$transaction(async (tx) => {
        if (makeCurrent) {
          await tx.academicPeriod.updateMany({
            where: { userId, isCurrent: true },
            data: { isCurrent: false },
          });
        }
        return tx.academicPeriod.create({
          data: {
            userId,
            name: data.name,
            startDate: fromDateOnly(data.startDate),
            endDate: fromDateOnly(data.endDate),
            isCurrent: makeCurrent,
          },
        });
      }),

    /** `where: { id, userId }` makes ownership part of the write itself (P2025 when it is not yours). */
    update: (userId: string, id: string, data: PeriodData, makeCurrent: boolean) =>
      prisma.$transaction(async (tx) => {
        if (makeCurrent) {
          await tx.academicPeriod.updateMany({
            where: { userId, isCurrent: true, id: { not: id } },
            data: { isCurrent: false },
          });
        }
        return tx.academicPeriod.update({
          where: { id, userId },
          data: { ...dates(data), ...(makeCurrent && { isCurrent: true }) },
        });
      }),

    countSubjects: (periodId: string) => prisma.subject.count({ where: { periodId } }),

    delete: async (userId: string, id: string) =>
      (await prisma.academicPeriod.deleteMany({ where: { id, userId } })).count > 0,
  };
}

export type PeriodRepository = ReturnType<typeof createPeriodRepository>;
