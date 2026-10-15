import { studyOfOnboarding, type CompleteOnboardingResponse } from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toPeriodDto, toStudyTrackDto } from '../mappers.js';
import { createPeriodRepository } from '../repositories/periodRepository.js';
import { createProfileRepository } from '../repositories/profileRepository.js';
import { createStudyTrackRepository } from '../repositories/studyTrackRepository.js';
import { profileInvariantBroken, toProfileDto } from './profileService.js';

const noHomePeriod = () =>
  new AppError(409, 'NO_CURRENT_PERIOD', 'Configura tu periodo académico antes de terminar.');

const conflictingChange = () =>
  new AppError(409, 'CONFLICT', 'Otra solicitud cambió tus estudios. Inténtalo de nuevo.');

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * COMPLETING THE ONBOARDING (P0.5-5, D35): a domain operation, not a profile field. In ONE transaction (the per-user study lock
 * first, the same one every study and period write takes, then the profile row) it finishes the wizard and, for a student who
 * said they study, turns the period they already created into the first period of a PRIMARY study (adopted in place: the period
 * keeps its id, dates, level, subjects, activities and blocks; only its `studyTrackId` changes).
 *
 *  - The body is empty: the server derives everything (what the study is called and which kind it is) from the profile the
 *    onboarding already confirmed (`studyOfOnboarding`). Nothing is created while the student is still answering.
 *  - Idempotent: an account that is already COMPLETED gets its current state back and nothing is written (so a retry, a double
 *    tap and a LEGACY account that finished before studies existed are all untouched: no silent migration).
 *  - A HOME period is required (`409 NO_CURRENT_PERIOD`): the wizard cannot end without the period the app hangs from.
 *  - A student who already has ANY study (they went to "Mis estudios" meanwhile) keeps their explicit setup: no second study is
 *    created and the primary one does not change; the onboarding is just completed.
 *  - A teacher, a personal use and a skipped profile get no study; a skipped profile (no answer) is not marked COMPLETED.
 *  - Any failure rolls back everything: never a study without COMPLETED, never COMPLETED with a half adoption.
 */
export function createOnboardingService(opts: { runInTransaction: RunInTransaction }) {
  return {
    async complete(userId: string): Promise<CompleteOnboardingResponse> {
      try {
        return await opts.runInTransaction(async (tx) => {
          const studies = createStudyTrackRepository(tx);
          const periods = createPeriodRepository(tx);
          const profiles = createProfileRepository(tx);
          await studies.lockUser(userId);
          await profiles.lock(userId);

          const profile = await profiles.find(userId);
          if (!profile) throw profileInvariantBroken();

          const home = await periods.findHomeCurrent(userId);
          const trackOf = async (period: typeof home) =>
            period?.studyTrackId ? await studies.findOwned(userId, period.studyTrackId) : null;

          // Already finished: the current state, and nothing written (idempotent; a legacy account stays as it is).
          if (profile.onboardingStatus === 'COMPLETED') {
            const track = await trackOf(home);
            return {
              profile: toProfileDto(profile),
              studyTrack: track && toStudyTrackDto(track),
              period: home && toPeriodDto(home),
            };
          }

          if (!home) throw noHomePeriod();

          let track = await trackOf(home);
          const study = studyOfOnboarding(profile);
          // Nothing is created for a teacher / personal use / no answer, nor when the student already set up any study.
          if (study && (await studies.countAll(userId)) === 0) {
            track = await studies.create({
              userId,
              name: study.name,
              type: study.type,
              programKey: study.programKey,
              isPrimary: true, // no study exists, so this one is the first active one
            });
            // Adopted, never copied: only the link changes; the period stays current if it was.
            await periods.update(userId, home.id, { studyTrackId: track.id }, false);
          }

          // A profile with no answer ("Omitir por ahora") ends the wizard without changing its status, as it always did.
          const updated =
            profile.primaryUse === null
              ? profile
              : await profiles.update(userId, { onboardingStatus: 'COMPLETED' });
          const period = await periods.findOwned(userId, home.id);
          return {
            profile: toProfileDto(updated),
            studyTrack: track && toStudyTrackDto(track),
            period: period && toPeriodDto(period),
          };
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflictingChange();
        throw err;
      }
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
