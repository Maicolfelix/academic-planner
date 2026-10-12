import {
  isOnboardingTransitionAllowed,
  resolveProgram,
  type Profile,
  type UpdateProfileInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import {
  createProfileRepository,
  type ProfileData,
  type ProfileRepository,
} from '../repositories/profileRepository.js';

type ProfileRow = Awaited<ReturnType<ProfileRepository['ensure']>>;

export const toProfileDto = (p: ProfileRow): Profile => ({
  primaryUse: p.primaryUse,
  programName: p.programName,
  programKey: p.programKey,
  onboardingStatus: p.onboardingStatus,
});

const invalidTransition = (from: string, to: string) =>
  new AppError(
    409,
    'INVALID_ONBOARDING_TRANSITION',
    'Ese cambio de estado del onboarding no es válido desde el estado actual.',
    { from, to },
  );

/**
 * The educational profile of the SESSION's user. The service never receives an owner from the client: the controller
 * passes the session's id. `primaryUse` and the program only describe; no rule anywhere reads them to allow or deny.
 */
export function createProfileService(profiles: ProfileRepository, inTransaction: RunInTransaction) {
  return {
    async get(userId: string): Promise<Profile> {
      return toProfileDto((await profiles.find(userId)) ?? (await profiles.ensure(userId)));
    },

    /**
     * A partial update. One transaction with the row locked: the program pair is resolved against what is stored (the name
     * is the authority; a catalog key brings its canonical name) and a status change must be one of the allowed steps.
     */
    async update(userId: string, input: UpdateProfileInput): Promise<Profile> {
      return inTransaction(async (tx) => {
        const repo = createProfileRepository(tx);
        await repo.ensure(userId);
        await repo.lock(userId);
        const current = (await repo.find(userId))!;

        const data: ProfileData = {};
        if (input.primaryUse !== undefined) data.primaryUse = input.primaryUse;
        if (input.programKey !== undefined || input.programName !== undefined) {
          const program = resolveProgram(current, input);
          data.programKey = program.programKey;
          data.programName = program.programName;
        }
        if (input.onboardingStatus !== undefined) {
          if (!isOnboardingTransitionAllowed(current.onboardingStatus, input.onboardingStatus)) {
            throw invalidTransition(current.onboardingStatus, input.onboardingStatus);
          }
          data.onboardingStatus = input.onboardingStatus;
        }
        return toProfileDto(await repo.update(userId, data));
      });
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
