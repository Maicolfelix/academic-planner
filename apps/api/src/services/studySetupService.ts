import {
  programOfNewTrack,
  type AdoptPeriodInput,
  type AdoptPeriodResponse,
  type SetupStudyTrackInput,
  type SetupStudyTrackResponse,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError, notFound } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toPeriodDto, toStudyTrackDto } from '../mappers.js';
import { createPeriodRepository } from '../repositories/periodRepository.js';
import { createStudyTrackRepository } from '../repositories/studyTrackRepository.js';
import { createNamedSubjects } from './subjectNames.js';

const periodAlreadyInStudy = () =>
  new AppError(409, 'PERIOD_ALREADY_IN_STUDY', 'Ese periodo ya pertenece a un estudio.');

/** Adopting the general current period must not leave the app without a HOME (the web would send the user to the onboarding). */
const primaryHasNoCurrentPeriod = () =>
  new AppError(
    409,
    'PRIMARY_STUDY_HAS_NO_CURRENT_PERIOD',
    'Tu estudio principal no tiene un periodo actual. Marca uno antes de convertir esta planificación.',
  );

const conflictingChange = () =>
  new AppError(409, 'CONFLICT', 'Otra solicitud cambió tus estudios. Inténtalo de nuevo.');

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * The two ORCHESTRATED actions of "Mis estudios", each ONE transaction that first takes the same per-user study lock the study and
 * period writes take (so two requests of one user never interleave, and "the first active study is the primary one" cannot be
 * true for two of them): nothing is ever left half done.
 *
 *  - `setup`: a new study + its first period (current in its scope) + optionally its first subjects;
 *  - `adoptPeriod`: a new study that takes over an EXISTING period of the user that belongs to no study. Nothing is copied or
 *    recreated: the period keeps its id and everything hanging from it (subjects, activities, schedule blocks), and it stays
 *    current if it was.
 *
 * Neither reads the profile to decide anything: the name and type come from the request (the web may PREFILL them from the
 * profile, but the student confirms), and the profile is never written.
 */
export function createStudySetupService(opts: { runInTransaction: RunInTransaction }) {
  const run = async <T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) => {
    try {
      return await opts.runInTransaction(async (tx) => {
        await createStudyTrackRepository(tx).lockUser(userId);
        return fn(tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflictingChange();
      throw err;
    }
  };

  return {
    async setup(userId: string, input: SetupStudyTrackInput): Promise<SetupStudyTrackResponse> {
      return run(userId, async (tx) => {
        const studies = createStudyTrackRepository(tx);
        const periods = createPeriodRepository(tx);
        const { programKey, name } = programOfNewTrack(input.track);
        const isPrimary = (await studies.countActive(userId)) === 0;
        const track = await studies.create({
          userId,
          name,
          type: input.track.type,
          programKey,
          isPrimary,
        });
        const { period: p } = input;
        // A brand-new study has no period yet: this one is its current period, with nothing to demote.
        const period = await periods.insert(
          userId,
          {
            name: p.name,
            startDate: p.startDate,
            endDate: p.endDate,
            studyLevel: p.studyLevel,
            studyLevelNote: p.studyLevelNote,
            studyTrackId: track.id,
          },
          true,
        );
        // The subjects take the TYPE of the study just created (the materializer reads it through this same transaction).
        const subjects =
          input.subjects && input.subjects.length > 0
            ? (await createNamedSubjects(tx, userId, period.id, input.subjects)).subjects
            : [];
        return {
          studyTrack: toStudyTrackDto(track),
          period: toPeriodDto(period),
          subjects,
        };
      });
    },

    async adoptPeriod(userId: string, input: AdoptPeriodInput): Promise<AdoptPeriodResponse> {
      return run(userId, async (tx) => {
        const studies = createStudyTrackRepository(tx);
        const periods = createPeriodRepository(tx);
        // Someone else's period and one that does not exist are the very same 404.
        const existing = await periods.findOwned(userId, input.periodId);
        if (!existing) throw notFound('Periodo no encontrado.');
        if (existing.studyTrackId !== null) throw periodAlreadyInStudy();

        const isPrimary = (await studies.countActive(userId)) === 0;
        // The general current period is HOME today. Taking it into a SECONDARY study would leave HOME to the primary study, which
        // must then have a current period of its own; otherwise the user would be sent to the onboarding.
        if (existing.isCurrent && !isPrimary) {
          const primary = (await studies.list(userId)).find((t) => t.isPrimary);
          if (!primary || !(await periods.findCurrentForTrack(userId, primary.id))) {
            throw primaryHasNoCurrentPeriod();
          }
        }

        const { programKey, name } = programOfNewTrack(input);
        const track = await studies.create({
          userId,
          name,
          type: input.type,
          programKey,
          isPrimary,
        });
        // The new study has no current period, so a current period stays current. Only the link changes.
        const period = await periods.update(userId, existing.id, { studyTrackId: track.id }, false);
        return { studyTrack: toStudyTrackDto(track), period: toPeriodDto(period) };
      });
    },
  };
}

export type StudySetupService = ReturnType<typeof createStudySetupService>;
