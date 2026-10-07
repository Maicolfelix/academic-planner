import type { Db } from '../db/prisma.js';

export interface SubjectCreateData {
  userId: string;
  periodId: string;
  name: string;
  nameKey: string;
  color: string;
  professor: string | null;
  description: string | null;
}

export interface SubjectUpdateData {
  name?: string;
  nameKey?: string;
  color?: string;
  professor?: string | null;
  description?: string | null;
}

/** Every query is scoped by userId: a subject id alone never reaches data. */
export function createSubjectRepository(prisma: Db) {
  return {
    list: (userId: string, periodId?: string) =>
      prisma.subject.findMany({
        where: { userId, ...(periodId && { periodId }) },
        orderBy: [{ nameKey: 'asc' }, { createdAt: 'asc' }],
      }),

    findOwned: (userId: string, id: string) => prisma.subject.findFirst({ where: { id, userId } }),

    create: (data: SubjectCreateData) => prisma.subject.create({ data }),

    findByNameKey: (userId: string, periodId: string, nameKey: string) =>
      prisma.subject.findFirst({ where: { userId, periodId, nameKey } }),

    /**
     * Creates the subject unless the period already has one with that name key, and says which happened. It is
     * `INSERT … ON CONFLICT DO NOTHING`, so a concurrent insert of the same name does not raise an error that would
     * abort the surrounding transaction: the existing subject is simply the one returned.
     */
    async createIfAbsent(data: SubjectCreateData) {
      const { count } = await prisma.subject.createMany({ data: [data], skipDuplicates: true });
      const subject = await prisma.subject.findFirst({
        where: { userId: data.userId, periodId: data.periodId, nameKey: data.nameKey },
      });
      return { subject: subject!, created: count > 0 };
    },

    /** What still hangs from a subject: its presence blocks deletion (no silent cascades). */
    async countDependents(subjectId: string) {
      const [activities, scheduleBlocks] = await Promise.all([
        prisma.activity.count({ where: { subjectId } }),
        prisma.scheduleBlock.count({ where: { subjectId } }),
      ]);
      return { activities, scheduleBlocks };
    },

    /** `where: { id, userId }` makes ownership part of the write itself (P2025 when it is not yours). */
    update: (userId: string, id: string, data: SubjectUpdateData) =>
      prisma.subject.update({ where: { id, userId }, data }),

    delete: async (userId: string, id: string) =>
      (await prisma.subject.deleteMany({ where: { id, userId } })).count > 0,
  };
}

export type SubjectRepository = ReturnType<typeof createSubjectRepository>;
