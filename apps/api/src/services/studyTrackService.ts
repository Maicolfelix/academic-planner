import {
  programOfNewTrack,
  resolveStudyTrackProgram,
  type CreateStudyTrackInput,
  type StudyTrack,
  type UpdateStudyTrackInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError, notFound } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toStudyTrackDto } from '../mappers.js';
import {
  createStudyTrackRepository,
  type StudyTrackData,
  type StudyTrackRepository,
} from '../repositories/studyTrackRepository.js';

const trackNotFound = () => notFound('Estudio no encontrado.');

const archivedCannotBePrimary = () =>
  new AppError(
    409,
    'STUDY_TRACK_ARCHIVED',
    'Un estudio archivado no puede ser el principal. Restáuralo primero.',
  );

const primaryNeedsReplacement = () =>
  new AppError(
    409,
    'PRIMARY_TRACK_REQUIRES_REPLACEMENT',
    'Es tu estudio principal y tienes otros activos. Elige primero otro como principal para poder archivarlo.',
  );

/** The partial unique index is the last line of defence; the per-user lock makes this practically unreachable. */
const conflictingChange = () =>
  new AppError(409, 'CONFLICT', 'Otra solicitud cambió tus estudios. Inténtalo de nuevo.');

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

type Row = Awaited<ReturnType<StudyTrackRepository['list']>>[number];
const dtos = (rows: Row[]): StudyTrack[] => rows.map(toStudyTrackDto);

/**
 * The studies (formations) of the SESSION's user: the owner always comes from the session, never from the client. Every write
 * runs in ONE transaction that first takes a per-user lock, so the rules that look at the other tracks ("is there a primary
 * one?", "is this the only active one?") cannot interleave with another request; the partial unique index of the database
 * remains the source of truth for "at most one primary".
 *
 * A study DESCRIBES. Nothing here (or anywhere) reads its `type` or `name` to allow or deny; it is linked to nothing yet (no
 * period, subject or profile) and archiving only marks it: nothing is ever deleted through this API.
 */
export function createStudyTrackService(
  tracks: StudyTrackRepository,
  inTransaction: RunInTransaction,
) {
  /** One locked transaction with a repository bound to it. A conflicting write (the index) becomes a clean 409. */
  const write = async <T>(userId: string, fn: (repo: StudyTrackRepository) => Promise<T>) => {
    try {
      return await inTransaction(async (tx) => {
        const repo = createStudyTrackRepository(tx);
        await repo.lockUser(userId);
        return fn(repo);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflictingChange();
      throw err;
    }
  };

  const owned = async (repo: StudyTrackRepository, userId: string, id: string) => {
    const track = await repo.findOwned(userId, id);
    if (!track) throw trackNotFound(); // unknown and somebody else's are the same answer
    return track;
  };

  return {
    async list(userId: string): Promise<StudyTrack[]> {
      return dtos(await tracks.list(userId)); // a read: it never writes
    },

    /**
     * The FIRST active study becomes the primary one (the server decides: the client never says whether there are others);
     * any later one is not. Zero active tracks is also the state of someone whose tracks are all archived.
     */
    async create(userId: string, input: CreateStudyTrackInput): Promise<StudyTrack> {
      return write(userId, async (repo) => {
        const { programKey, name } = programOfNewTrack(input);
        const isPrimary = (await repo.countActive(userId)) === 0;
        return toStudyTrackDto(
          await repo.create({ userId, name, type: input.type, programKey, isPrimary }),
        );
      });
    },

    /**
     * Name, type and catalog key only. Changing the type (it is correctable) touches NOTHING else: the subjects keep the
     * `educationContext` they were created with. A name of their own drops the key; a key brings the canonical name.
     */
    async update(userId: string, id: string, input: UpdateStudyTrackInput): Promise<StudyTrack> {
      return write(userId, async (repo) => {
        const current = await owned(repo, userId, id);
        const data: StudyTrackData = {};
        if (input.type !== undefined) data.type = input.type;
        if (input.name !== undefined || input.programKey !== undefined) {
          Object.assign(data, resolveStudyTrackProgram(current, input));
        }
        return toStudyTrackDto(await repo.update(userId, id, data));
      });
    },

    /**
     * Moves the primary flag in one transaction (never a moment without one, never two). An archived study cannot be it.
     * Choosing the one that already is it changes nothing. Answers the whole list: several rows change.
     */
    async makePrimary(userId: string, id: string): Promise<StudyTrack[]> {
      return write(userId, async (repo) => {
        const target = await owned(repo, userId, id);
        if (target.status !== 'ACTIVE') throw archivedCannotBePrimary();
        await repo.clearPrimary(userId, id);
        if (!target.isPrimary) await repo.update(userId, id, { isPrimary: true });
        return dtos(await repo.list(userId));
      });
    },

    /**
     * Marks a study as finished or paused; it keeps all its history. The primary one cannot leave while other active ones
     * exist: the student chooses the replacement (nothing is picked silently). The only active study may be archived, which
     * leaves no primary (zero is a valid state). Its current period stops being current in the same transaction (the periods
     * and everything in them stay). Archiving an archived one changes nothing.
     */
    async archive(userId: string, id: string): Promise<StudyTrack[]> {
      return write(userId, async (repo) => {
        const target = await owned(repo, userId, id);
        if (target.status === 'ACTIVE') {
          if (target.isPrimary && (await repo.countActive(userId)) > 1) {
            throw primaryNeedsReplacement();
          }
          await repo.update(userId, id, { status: 'ARCHIVED', isPrimary: false });
          // Same transaction: the study stops being the home or a current one. Nothing is deleted.
          await repo.clearCurrentPeriods(userId, id);
        }
        return dtos(await repo.list(userId));
      });
    },

    /**
     * ARCHIVED -> ACTIVE. It becomes the primary one only if it is the only active study (the same rule as the first one
     * created): it never takes the place of an existing primary. It does NOT make any of its periods current again (there may
     * be several and the server does not guess which): the student marks one. Restoring an active one changes nothing.
     */
    async restore(userId: string, id: string): Promise<StudyTrack[]> {
      return write(userId, async (repo) => {
        const target = await owned(repo, userId, id);
        if (target.status === 'ARCHIVED') {
          const isPrimary = (await repo.countActive(userId)) === 0;
          await repo.update(userId, id, { status: 'ACTIVE', isPrimary });
        }
        return dtos(await repo.list(userId));
      });
    },
  };
}

export type StudyTrackService = ReturnType<typeof createStudyTrackService>;
