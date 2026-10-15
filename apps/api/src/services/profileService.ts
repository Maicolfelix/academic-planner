import {
  isOnboardingTransitionAllowed,
  resolveProgram,
  type Profile,
  type UpdateProfileInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { createStudyTrackRepository } from '../repositories/studyTrackRepository.js';
import {
  createProfileRepository,
  type ProfileData,
  type ProfileRepository,
} from '../repositories/profileRepository.js';

type ProfileRow = NonNullable<Awaited<ReturnType<ProfileRepository['find']>>>;

export const toProfileDto = (p: ProfileRow): Profile => ({
  primaryUse: p.primaryUse,
  programName: p.programName,
  programKey: p.programKey,
  onboardingStatus: p.onboardingStatus,
});

/**
 * Every account has exactly one profile (created with it, and by the migration for the older ones), so a signed-in user
 * WITHOUT one means the invariant is broken somewhere else. It is an internal failure, not a 404 (the user exists) and not
 * something to quietly repair on a read: the client gets a generic message and the server logs the error.
 */
export const profileInvariantBroken = () =>
  new AppError(
    500,
    'PROFILE_INVARIANT_BROKEN',
    'Ocurrió un error interno. Inténtalo de nuevo más tarde.',
  );

const invalidTransition = (from: string, to: string) =>
  new AppError(
    409,
    'INVALID_ONBOARDING_TRANSITION',
    'Ese cambio de estado del onboarding no es válido desde el estado actual.',
    { from, to },
  );

/** Once a study exists, "which program" is said in Mis estudios: the profile's copy is only legacy / onboarding staging. */
const programManagedByStudy = () =>
  new AppError(409, 'PROGRAM_MANAGED_BY_STUDY', 'Tu programa se administra desde Mis estudios.');

/**
 * The educational profile of the SESSION's user. The service never receives an owner from the client: the controller
 * passes the session's id. `primaryUse` and the program only describe; no rule anywhere reads them to allow or deny.
 */
export function createProfileService(profiles: ProfileRepository, inTransaction: RunInTransaction) {
  return {
    async get(userId: string): Promise<Profile> {
      const profile = await profiles.find(userId); // a read: it never writes
      if (!profile) throw profileInvariantBroken();
      return toProfileDto(profile);
    },

    /**
     * A partial update of the EXISTING profile (never created here). One transaction with the row locked: the program pair is resolved against what is stored (the name
     * is the authority; a catalog key brings its canonical name) and a status change must be one of the allowed steps.
     */
    async update(userId: string, input: UpdateProfileInput): Promise<Profile> {
      return inTransaction(async (tx) => {
        const repo = createProfileRepository(tx);
        // The same order as completing the onboarding (the study lock, then the row): no two requests wait on each other.
        const studies = createStudyTrackRepository(tx);
        await studies.lockUser(userId);
        await repo.lock(userId); // a missing row locks nothing: it is checked right after, never created
        const current = await repo.find(userId);
        if (!current) throw profileInvariantBroken();

        const data: ProfileData = {};
        if (input.primaryUse !== undefined) data.primaryUse = input.primaryUse;
        if (input.programKey !== undefined || input.programName !== undefined) {
          // P0.5-5: the study is the authority of the formation. With any study (archived too) the profile's program is no longer
          // editable here, and nothing keeps the two in step (no dual write). Without one (the onboarding's staging, and the
          // accounts that finished before studies existed) it works as always.
          if ((await studies.countAll(userId)) > 0) throw programManagedByStudy();
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
