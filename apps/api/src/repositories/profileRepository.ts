import type { Db } from '../db/prisma.js';
import type { OnboardingStatus, PrimaryUse } from '../generated/prisma/client.js';

export interface ProfileData {
  primaryUse?: PrimaryUse | null;
  programName?: string | null;
  programKey?: string | null;
  onboardingStatus?: OnboardingStatus;
}

/**
 * The profile is 1:1 with the user and its key IS the user id: every query is by the session's user, so there is no id
 * that could point at somebody else's row. Accepts a transaction client too.
 */
export function createProfileRepository(db: Db) {
  return {
    find: (userId: string) => db.userProfile.findUnique({ where: { userId } }),

    /**
     * The row, created empty when it does not exist. It always exists (registration and the migration create it), so this
     * only guards against a hole instead of answering 500 for it; the primary key makes a race harmless.
     */
    ensure: (userId: string) =>
      db.userProfile.upsert({ where: { userId }, create: { userId }, update: {} }),

    /** Locks the row until the surrounding transaction ends, so two simultaneous status changes run one after the other. */
    async lock(userId: string): Promise<void> {
      await db.$queryRaw`SELECT "userId" FROM "UserProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    },

    update: (userId: string, data: ProfileData) =>
      db.userProfile.update({ where: { userId }, data }),
  };
}

export type ProfileRepository = ReturnType<typeof createProfileRepository>;
