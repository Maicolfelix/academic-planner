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

    // There is deliberately no "create" here: a profile is created only WITH its account (registration, and the migration
    // for the accounts that already existed). Nothing in a request path may create or repair one.

    /**
     * Locks the row until the surrounding transaction ends, so two simultaneous status changes run one after the other.
     * A row that does not exist locks nothing (and is NOT created): the caller reads it afterwards and decides.
     */
    async lock(userId: string): Promise<void> {
      await db.$queryRaw`SELECT "userId" FROM "UserProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    },

    update: (userId: string, data: ProfileData) =>
      db.userProfile.update({ where: { userId }, data }),
  };
}

export type ProfileRepository = ReturnType<typeof createProfileRepository>;
