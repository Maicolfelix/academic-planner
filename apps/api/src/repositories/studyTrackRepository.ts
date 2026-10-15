import type { Db } from '../db/prisma.js';
import type { EducationContext, StudyTrackStatus } from '../generated/prisma/client.js';

export interface NewStudyTrack {
  userId: string;
  name: string;
  type: EducationContext;
  programKey: string | null;
  isPrimary: boolean;
}

export interface StudyTrackData {
  name?: string;
  type?: EducationContext;
  programKey?: string | null;
  isPrimary?: boolean;
  status?: StudyTrackStatus;
}

/**
 * Every query is scoped by `userId`: a track id alone never reaches a row, and the composite key `(id, userId)` makes the
 * write itself refuse somebody else's. Accepts a transaction client too.
 */
export function createStudyTrackRepository(db: Db) {
  return {
    /** The API's order: the primary first, then the active ones, then the archived; each by creation (the id breaks ties). */
    list: (userId: string) =>
      db.studyTrack.findMany({
        where: { userId },
        orderBy: [{ isPrimary: 'desc' }, { status: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),

    findOwned: (userId: string, id: string) => db.studyTrack.findFirst({ where: { id, userId } }),

    countActive: (userId: string) => db.studyTrack.count({ where: { userId, status: 'ACTIVE' } }),

    /** Every study of the user, archived ones included: "has this person set up any study at all?" */
    countAll: (userId: string) => db.studyTrack.count({ where: { userId } }),

    /** One transaction at a time per user: the rules below read the other tracks, so two requests must not interleave. */
    async lockUser(userId: string): Promise<void> {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-track:${userId}`}, 0))`;
    },

    create: (data: NewStudyTrack) => db.studyTrack.create({ data }),

    update: (userId: string, id: string, data: StudyTrackData) =>
      db.studyTrack.update({ where: { id_userId: { id, userId } }, data }),

    /**
     * Un-marks every current period of one study (an archived study has no current period). The periods themselves, and their
     * subjects, activities and schedule blocks, are not touched.
     */
    clearCurrentPeriods: (userId: string, studyTrackId: string) =>
      db.academicPeriod.updateMany({
        where: { userId, studyTrackId, isCurrent: true },
        data: { isCurrent: false },
      }),

    /** Takes the primary flag away from every track of the user except `exceptId`. */
    clearPrimary: (userId: string, exceptId: string) =>
      db.studyTrack.updateMany({
        where: { userId, isPrimary: true, id: { not: exceptId } },
        data: { isPrimary: false },
      }),
  };
}

export type StudyTrackRepository = ReturnType<typeof createStudyTrackRepository>;
