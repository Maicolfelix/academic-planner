import type { Db } from '../db/prisma.js';

export interface ProfileData {
  minMilli: number;
  maxMilli: number;
  passMilli: number;
  decimals: number;
}

export interface EvaluationData {
  subjectId: string;
  gradingPeriodId: string;
  activityId: string | null;
  name: string;
  periodShareBp: number;
  scoreMilli: number | null;
  rawEarnedMilli: number | null;
  rawMaxMilli: number | null;
  scoredAt: Date | null;
}

/**
 * Grades storage (D36). Every query is scoped by `userId`: a foreign or unknown id is simply "not found" here, and the service turns
 * both into the same 404. It accepts a transaction client, so a write can read and write through one connection.
 */
export function createGradingRepository(db: Db) {
  return {
    // ── Profile ──
    findProfile: (userId: string, periodId: string) =>
      db.gradingProfile.findFirst({ where: { userId, periodId } }),
    createProfile: (userId: string, periodId: string, data: ProfileData) =>
      db.gradingProfile.create({ data: { userId, periodId, ...data } }),
    updateProfile: (userId: string, id: string, data: Partial<ProfileData>) =>
      db.gradingProfile.update({ where: { id, userId }, data }),

    // ── Cuts ──
    listCuts: (userId: string, periodId: string) =>
      db.gradingPeriod.findMany({ where: { userId, periodId }, orderBy: { position: 'asc' } }),
    findCut: (userId: string, id: string) => db.gradingPeriod.findFirst({ where: { id, userId } }),
    async nextCutPosition(periodId: string): Promise<number> {
      const last = await db.gradingPeriod.aggregate({
        where: { periodId },
        _max: { position: true },
      });
      return (last._max.position ?? 0) + 1;
    },
    /** Σ finalShareBp of the period's cuts, leaving one out (the one being edited). */
    async sumCutShares(userId: string, periodId: string, exceptId?: string): Promise<number> {
      const sum = await db.gradingPeriod.aggregate({
        where: { userId, periodId, ...(exceptId && { id: { not: exceptId } }) },
        _sum: { finalShareBp: true },
      });
      return sum._sum.finalShareBp ?? 0;
    },
    createCut: (
      userId: string,
      periodId: string,
      data: { name: string; finalShareBp: number; position: number },
    ) => db.gradingPeriod.create({ data: { userId, periodId, ...data } }),
    updateCut: (userId: string, id: string, data: { name?: string; finalShareBp?: number }) =>
      db.gradingPeriod.update({ where: { id, userId }, data }),
    deleteCut: async (userId: string, id: string) =>
      (await db.gradingPeriod.deleteMany({ where: { id, userId } })).count > 0,
    countEvaluationsInCut: (userId: string, gradingPeriodId: string) =>
      db.evaluation.count({ where: { userId, gradingPeriodId } }),

    // ── Evaluations ──
    findEvaluation: (userId: string, id: string) =>
      db.evaluation.findFirst({ where: { id, userId } }),
    listForSubject: (userId: string, subjectId: string) =>
      db.evaluation.findMany({
        where: { userId, subjectId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    /** Σ periodShareBp of one subject inside one cut, leaving one out (the one being edited). */
    async sumEvaluationShares(
      userId: string,
      subjectId: string,
      gradingPeriodId: string,
      exceptId?: string,
    ): Promise<number> {
      const sum = await db.evaluation.aggregate({
        where: { userId, subjectId, gradingPeriodId, ...(exceptId && { id: { not: exceptId } }) },
        _sum: { periodShareBp: true },
      });
      return sum._sum.periodShareBp ?? 0;
    },
    createEvaluation: (userId: string, periodId: string, data: EvaluationData) =>
      db.evaluation.create({ data: { userId, periodId, ...data } }),
    updateEvaluation: (userId: string, id: string, data: Partial<EvaluationData>) =>
      db.evaluation.update({ where: { id, userId }, data }),
    deleteEvaluation: async (userId: string, id: string) =>
      (await db.evaluation.deleteMany({ where: { id, userId } })).count > 0,

    // ── Facts the rules ask about a whole period / subject ──
    async hasScores(userId: string, periodId: string): Promise<boolean> {
      return (
        (await db.evaluation.count({ where: { userId, periodId, scoreMilli: { not: null } } })) > 0
      );
    },
    async hasGrading(userId: string, periodId: string): Promise<boolean> {
      const [profiles, cuts] = await Promise.all([
        db.gradingProfile.count({ where: { userId, periodId } }),
        db.gradingPeriod.count({ where: { userId, periodId } }),
      ]);
      return profiles > 0 || cuts > 0;
    },
    countEvaluationsOfSubject: (userId: string, subjectId: string) =>
      db.evaluation.count({ where: { userId, subjectId } }),
    countEvaluationsOfActivity: (userId: string, activityId: string) =>
      db.evaluation.count({ where: { userId, activityId } }),
  };
}

export type GradingRepository = ReturnType<typeof createGradingRepository>;
