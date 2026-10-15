import {
  END_AFTER_START_ERROR,
  isEndAfterStart,
  resolveStudyLevel,
  type CreatePeriodInput,
  type UpdatePeriodInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError, notFound, validationError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toDateOnly, toPeriodDto } from '../mappers.js';
import { toCurrentPeriodContext } from './currentPeriods.js';
import { createPeriodRepository, type PeriodRepository } from '../repositories/periodRepository.js';
import {
  createStudyTrackRepository,
  type StudyTrackRepository,
} from '../repositories/studyTrackRepository.js';

const periodNotFound = () => notFound('Periodo no encontrado.');
const studyNotFound = () => notFound('Estudio no encontrado.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const notEmpty = () =>
  new AppError(
    409,
    'PERIOD_NOT_EMPTY',
    'Este periodo todavía tiene asignaturas, actividades o bloques de agenda. Elimínalos primero para poder borrarlo.',
  );

const archivedStudy = () =>
  new AppError(409, 'STUDY_TRACK_ARCHIVED', 'Ese estudio está archivado. Restáuralo primero.');

/** Moving a CURRENT period into a scope that already has one never demotes either of them: the user decides. */
const currentConflict = () =>
  new AppError(
    409,
    'CURRENT_PERIOD_CONFLICT',
    'Ese estudio ya tiene un periodo actual. Cambia primero cuál es el actual, o mueve este periodo cuando no lo sea.',
  );

const conflictingCurrent = () =>
  new AppError(409, 'CONFLICT', 'Otra solicitud cambió el periodo actual. Inténtalo de nuevo.');

/** The study must be the user's own (a foreign or unknown one is the very same 404) and ACTIVE (never silently restored). */
async function usableStudy(studies: StudyTrackRepository, userId: string, id: string) {
  const study = await studies.findOwned(userId, id);
  if (!study) throw studyNotFound();
  if (study.status !== 'ACTIVE') throw archivedStudy();
  return study;
}

/**
 * The periods of the SESSION's user. A period belongs to a STUDY or to none (`studyTrackId` null: personal organization,
 * teaching, older accounts; a permanent and valid state), and "current" is one per SCOPE: one general period plus one per study,
 * all of which may be current at once (the database's partial unique indexes decide; two in the same scope never can).
 *
 * Every write runs in ONE transaction that first takes the per-user study lock (the same one the study actions take), so a
 * period cannot become current in a study that is being archived, and two requests of one user never interleave.
 */
export function createPeriodService(periods: PeriodRepository, inTransaction: RunInTransaction) {
  const write = async <T>(
    userId: string,
    fn: (repo: PeriodRepository, studies: StudyTrackRepository) => Promise<T>,
  ) => {
    try {
      return await inTransaction(async (tx) => {
        const studies = createStudyTrackRepository(tx);
        await studies.lockUser(userId);
        return fn(createPeriodRepository(tx), studies);
      });
    } catch (err) {
      // The lock makes this practically unreachable; the partial unique indexes stay the last line of defence.
      if (isPrismaError(err, 'P2002')) throw conflictingCurrent();
      throw err;
    }
  };

  return {
    async list(userId: string) {
      return (await periods.list(userId)).map(toPeriodDto);
    },

    /** The HOME current period of the session's user (see `findHomeCurrent`), or null. A read: it never writes or infers. */
    async home(userId: string) {
      const period = await periods.findHomeCurrent(userId);
      return period ? toPeriodDto(period) : null;
    },

    /** Every current, active period with its study (`PeriodLookup.listCurrent`, the one definition), in its fixed order. */
    async current(userId: string) {
      return (await periods.listCurrent(userId)).map(toCurrentPeriodContext);
    },

    async get(userId: string, id: string) {
      const period = await periods.findOwned(userId, id);
      if (!period) throw periodNotFound();
      return toPeriodDto(period);
    },

    /**
     * The first period OF ITS SCOPE (the general one, or the one of a study) is always the current one of that scope; later
     * ones only if asked, and asking demotes only the current period of the SAME scope. `studyTrackId` omitted or null: a
     * general period; a uuid: that study's period (the user's own and active).
     */
    async create(userId: string, input: CreatePeriodInput) {
      return write(userId, async (repo, studies) => {
        const studyTrackId = input.studyTrackId ?? null;
        if (studyTrackId !== null) await usableStudy(studies, userId, studyTrackId);
        const makeCurrent =
          input.isCurrent === true || !(await repo.hasCurrentInScope(userId, studyTrackId));
        if (makeCurrent) await repo.demoteCurrentInScope(userId, studyTrackId);
        const { name, startDate, endDate, studyLevel, studyLevelNote } = input;
        return toPeriodDto(
          await repo.insert(
            userId,
            { name, startDate, endDate, studyLevel, studyLevelNote, studyTrackId },
            makeCurrent,
          ),
        );
      });
    },

    /**
     * Besides the usual fields it may MOVE the period to a study (`studyTrackId` uuid) or leave it general (`null`). A period
     * that is not current moves freely; a CURRENT one keeps being current only when the destination scope has no current
     * period, otherwise `409 CURRENT_PERIOD_CONFLICT` (nobody is demoted silently). Marking a period current demotes only the
     * current one of its own scope. A study that is not the user's is the same 404 as one that does not exist; an archived
     * one is a 409, and a period of an archived study cannot be marked current.
     */
    async update(userId: string, id: string, input: UpdatePeriodInput) {
      return write(userId, async (repo, studies) => {
        const existing = await repo.findOwned(userId, id);
        if (!existing) throw periodNotFound();

        // The schema only compares dates present in the request; the other half comes from storage.
        const startDate = input.startDate ?? toDateOnly(existing.startDate);
        const endDate = input.endDate ?? toDateOnly(existing.endDate);
        if (!isEndAfterStart(startDate, endDate)) {
          throw validationError({ endDate: [END_AFTER_START_ERROR] });
        }

        const target =
          input.studyTrackId === undefined ? existing.studyTrackId : input.studyTrackId;
        const moving = target !== existing.studyTrackId;
        const becomingCurrent = input.isCurrent === true && !existing.isCurrent;

        if (target !== null && (moving || becomingCurrent))
          await usableStudy(studies, userId, target);
        if (moving && existing.isCurrent && (await repo.otherCurrentInScope(userId, target, id))) {
          throw currentConflict();
        }
        if (becomingCurrent) await repo.demoteCurrentInScope(userId, target, id);

        // The level is only touched when the request mentions it; a number or a note replaces the other (never both).
        const level =
          input.studyLevel !== undefined || input.studyLevelNote !== undefined
            ? resolveStudyLevel(existing, input)
            : {};
        try {
          const { name, startDate: s, endDate: e } = input;
          const updated = await repo.update(
            userId,
            id,
            { name, startDate: s, endDate: e, ...level, ...(moving && { studyTrackId: target }) },
            becomingCurrent,
          );
          return toPeriodDto(updated);
        } catch (err) {
          if (isPrismaError(err, 'P2025')) throw periodNotFound();
          throw err;
        }
      });
    },

    /** Never cascades: a period with subjects, activities or schedule blocks must be emptied by the user first. */
    async remove(userId: string, id: string) {
      if (!(await periods.findOwned(userId, id))) throw periodNotFound();
      // Subjects, standalone schedule blocks (a study session has no subject but has a period) AND activities: a
      // general activity has no subject, so counting subjects would not see it.
      const [subjectCount, blockCount, activityCount] = await Promise.all([
        periods.countSubjects(id),
        periods.countScheduleBlocks(id),
        periods.countActivities(id),
      ]);
      if (subjectCount > 0 || blockCount > 0 || activityCount > 0) throw notEmpty();
      try {
        if (!(await periods.delete(userId, id))) throw periodNotFound();
      } catch (err) {
        // A subject, block or activity was added between the check and the delete: the foreign key still says no.
        if (isPrismaError(err, 'P2003')) throw notEmpty();
        throw err;
      }
    },
  };
}

export type PeriodService = ReturnType<typeof createPeriodService>;
