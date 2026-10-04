import type { PrismaClient } from '../db/prisma.js';

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
export function createSubjectRepository(prisma: PrismaClient) {
  return {
    list: (userId: string, periodId?: string) =>
      prisma.subject.findMany({
        where: { userId, ...(periodId && { periodId }) },
        orderBy: [{ nameKey: 'asc' }, { createdAt: 'asc' }],
      }),

    findOwned: (userId: string, id: string) => prisma.subject.findFirst({ where: { id, userId } }),

    create: (data: SubjectCreateData) => prisma.subject.create({ data }),

    countActivities: (subjectId: string) => prisma.activity.count({ where: { subjectId } }),

    /** `where: { id, userId }` makes ownership part of the write itself (P2025 when it is not yours). */
    update: (userId: string, id: string, data: SubjectUpdateData) =>
      prisma.subject.update({ where: { id, userId }, data }),

    delete: async (userId: string, id: string) =>
      (await prisma.subject.deleteMany({ where: { id, userId } })).count > 0,
  };
}

export type SubjectRepository = ReturnType<typeof createSubjectRepository>;
