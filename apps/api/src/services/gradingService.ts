import {
  WEIGHT_BP_MAX,
  cutGradeName,
  rawToScoreMilli,
  requiredScore,
  scaleProblems,
  summarizeSubjectGrade,
  type CreateEvaluationInput,
  type CreateGradingPeriodInput,
  type CreateGradingProfileInput,
  type SetupSubjectGradingInput,
  type SubjectGradesResponse,
  type UpdateEvaluationInput,
  type UpdateGradingPeriodInput,
  type UpdateGradingProfileInput,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError, notFound, validationError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toEvaluationDto, toGradingPeriodDto, toGradingProfileDto } from '../mappers.js';
import {
  createActivityRepository,
  type ActivityRepository,
} from '../repositories/activityRepository.js';
import {
  createGradingRepository,
  type GradingRepository,
} from '../repositories/gradingRepository.js';
import { createPeriodRepository, type PeriodRepository } from '../repositories/periodRepository.js';
import {
  createStudyTrackRepository,
  type StudyTrackRepository,
} from '../repositories/studyTrackRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';

const periodNotFound = () => notFound('Periodo no encontrado.');
const subjectNotFound = () => notFound('Asignatura no encontrada.');
const cutNotFound = () => notFound('Corte no encontrado.');
const evaluationNotFound = () => notFound('Evaluación no encontrada.');
const activityNotFound = () => notFound('Actividad no encontrada.');
const profileNotFound = () => notFound('Las notas de este periodo no están configuradas.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const notTracked = () =>
  new AppError(
    409,
    'PERIOD_NOT_TRACKED',
    'Las notas necesitan un periodo que pertenezca a un estudio. Asigna este periodo a un estudio primero.',
  );
const notConfigured = () =>
  new AppError(
    409,
    'GRADING_NOT_CONFIGURED',
    'Configura primero la escala de notas de este periodo.',
  );
const alreadyConfigured = () =>
  new AppError(409, 'GRADING_EXISTS', 'Este periodo ya tiene la escala de notas configurada.');
const scaleLocked = () =>
  new AppError(
    409,
    'GRADING_SCALE_LOCKED',
    'Ya hay notas registradas: la nota mínima y la máxima no se pueden cambiar.',
  );
const cutsExist = () =>
  new AppError(409, 'GRADING_EXISTS', 'Esta materia ya tiene sus cortes configurados.');
const cutNotEmpty = () =>
  new AppError(409, 'GRADING_PERIOD_NOT_EMPTY', 'Este corte todavía tiene evaluaciones.');

const cutHasDirectGrade = () =>
  new AppError(
    409,
    'CUT_HAS_DIRECT_GRADE',
    'Este corte tiene una nota directa. Quítala si quieres desglosarlo en evaluaciones.',
  );
const cutHasEvaluations = () =>
  new AppError(
    409,
    'CUT_HAS_EVALUATIONS',
    'Este corte ya está desglosado en evaluaciones. Registra las notas en cada una.',
  );
const cutGradeExists = () =>
  new AppError(
    409,
    'CUT_GRADE_EXISTS',
    'Este corte ya tiene una nota. Edítala en lugar de crear otra.',
  );

const weightExceeded = (field: string, what: string) =>
  validationError({ [field]: [`${what} no pueden sumar más de 100 %.`] });

/**
 * Grades of the SESSION's user (D36). Every write runs in ONE transaction that first takes the per-user study lock (the one the
 * period and study actions take), so the weight sums (cuts of a period, evaluations of a subject in a cut) can never be pushed
 * past 100 % by two simultaneous requests, and a period cannot lose its study while a grading row is being written.
 *
 * Reads that only learn an immutable fact (a row's period) happen before the lock; everything that decides a write is re-read
 * after it.
 */
export function createGradingService(deps: {
  grading: GradingRepository;
  subjects: SubjectRepository;
  activities: ActivityRepository;
  periods: PeriodRepository;
  studyTracks: StudyTrackRepository;
  runInTransaction: RunInTransaction;
  clock: () => Date;
}) {
  const { grading, subjects, activities, periods, studyTracks, runInTransaction, clock } = deps;

  const write = <T>(
    userId: string,
    fn: (tx: Prisma.TransactionClient, repo: GradingRepository) => Promise<T>,
  ) =>
    runInTransaction(async (tx) => {
      await createStudyTrackRepository(tx).lockUser(userId);
      return fn(tx, createGradingRepository(tx));
    });

  /** The period must be the user's own (foreign = unknown = 404) and belong to a study. */
  async function trackedPeriod(tx: Prisma.TransactionClient, userId: string, periodId: string) {
    const period = await createPeriodRepository(tx).findOwned(userId, periodId);
    if (!period) throw periodNotFound();
    if (period.studyTrackId === null) throw notTracked();
    return period;
  }

  /** An activity of THIS subject (a general activity has no subject, so it can never be linked). */
  async function checkActivity(
    tx: Prisma.TransactionClient,
    userId: string,
    activityId: string,
    subjectId: string,
  ) {
    const activity = await createActivityRepository(tx).findOwned(userId, activityId);
    if (!activity) throw activityNotFound();
    if (activity.subjectId !== subjectId)
      throw validationError({
        activityId: ['La actividad debe ser de la misma asignatura que la evaluación.'],
      });
  }

  /**
   * The canonical score (always in the profile's scale) of an evaluation being written.
   *  - `score` given: that one (null = none), checked against the scale;
   *  - a numeric "earned/max" pair without a score: on a scale that starts at 0 the score is RECOMPUTED from the new pair; on any
   *    other scale there is no honest conversion, so the student must give the score (400) — the previous one is never kept;
   *  - no pair at all: `fallback` (the stored score; null on create).
   */
  function resolveScore(
    scale: { minMilli: number; maxMilli: number },
    score: number | null | undefined,
    raw: { earned: number | null | undefined; max: number | null | undefined },
    fallback: number | null,
  ): number | null {
    let result: number | null;
    if (score !== undefined) result = score;
    else if (typeof raw.earned === 'number' && typeof raw.max === 'number') {
      result = rawToScoreMilli(scale, raw.earned, raw.max);
      if (result === null)
        throw validationError({
          scoreMilli: ['En esta escala escribe la nota ya convertida; no se calcula sola.'],
        });
    } else result = fallback;
    if (result !== null && (result < scale.minMilli || result > scale.maxMilli))
      throw validationError({ scoreMilli: ['La nota está fuera de la escala del periodo.'] });
    return result;
  }

  return {
    async setupProfile(userId: string, periodId: string, input: CreateGradingProfileInput) {
      try {
        return await write(userId, async (tx, repo) => {
          await trackedPeriod(tx, userId, periodId);
          if (await repo.findProfile(userId, periodId)) throw alreadyConfigured();
          return toGradingProfileDto(await repo.createProfile(userId, periodId, input));
        });
      } catch (err) {
        if (isPrismaError(err, 'P2002')) throw alreadyConfigured();
        throw err;
      }
    },

    /**
     * How the final grade of ONE subject is split, in ONE transaction (all or nothing). The SCALE belongs to the period: the first
     * subject configured creates it (it needs `input.profile`); once it exists a profile sent again is ignored and the existing one
     * is returned, so two subjects configured at the same time (serialized by the per-user lock) end with ONE profile and their own
     * independent cuts. A subject that already has cuts is a 409.
     */
    async setupSubjectGrading(userId: string, subjectId: string, input: SetupSubjectGradingInput) {
      const subject = await subjects.findOwned(userId, subjectId);
      if (!subject) throw subjectNotFound();
      try {
        return await write(userId, async (tx, repo) => {
          await trackedPeriod(tx, userId, subject.periodId);
          if ((await repo.countCutsOfSubject(userId, subject.id)) > 0) throw cutsExist();
          let profile = await repo.findProfile(userId, subject.periodId);
          if (!profile) {
            if (!input.profile)
              throw validationError({ profile: ['Configura primero la escala del periodo.'] });
            profile = await repo.createProfile(userId, subject.periodId, input.profile);
          }
          const cuts = [];
          for (const [i, cut] of input.gradingPeriods.entries())
            cuts.push(
              await repo.createCut(userId, subject.periodId, subject.id, {
                ...cut,
                position: i + 1,
              }),
            );
          return {
            profile: toGradingProfileDto(profile),
            gradingPeriods: cuts.map(toGradingPeriodDto),
          };
        });
      } catch (err) {
        if (isPrismaError(err, 'P2002')) throw cutsExist();
        throw err;
      }
    },

    /** A read: the period's SCALE (shared by its subjects), or `profile: null` while it is not configured. */
    async getPeriodGrading(userId: string, periodId: string) {
      if (!(await periods.findOwned(userId, periodId))) throw periodNotFound();
      const profile = await grading.findProfile(userId, periodId);
      return { profile: profile ? toGradingProfileDto(profile) : null };
    },

    async updateProfile(userId: string, periodId: string, input: UpdateGradingProfileInput) {
      return write(userId, async (tx, repo) => {
        await trackedPeriod(tx, userId, periodId);
        const profile = await repo.findProfile(userId, periodId);
        if (!profile) throw profileNotFound();
        const merged = {
          minMilli: input.minMilli ?? profile.minMilli,
          maxMilli: input.maxMilli ?? profile.maxMilli,
          passMilli: input.passMilli ?? profile.passMilli,
        };
        const problems = scaleProblems(merged);
        if (Object.keys(problems).length > 0)
          throw validationError(
            Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, [v]])),
          );
        const scaleChanged =
          merged.minMilli !== profile.minMilli || merged.maxMilli !== profile.maxMilli;
        if (scaleChanged && (await repo.hasScores(userId, periodId))) throw scaleLocked();
        return toGradingProfileDto(await repo.updateProfile(userId, profile.id, input));
      });
    },

    /** A cut of ONE subject: it never touches the cuts of another subject, even in the same period. */
    async createCut(userId: string, subjectId: string, input: CreateGradingPeriodInput) {
      const subject = await subjects.findOwned(userId, subjectId);
      if (!subject) throw subjectNotFound();
      return write(userId, async (tx, repo) => {
        await trackedPeriod(tx, userId, subject.periodId);
        if (!(await repo.findProfile(userId, subject.periodId))) throw notConfigured();
        if ((await repo.sumCutShares(userId, subject.id)) + input.finalShareBp > WEIGHT_BP_MAX)
          throw weightExceeded('finalShareBp', 'Los cortes');
        const position = await repo.nextCutPosition(subject.id);
        return toGradingPeriodDto(
          await repo.createCut(userId, subject.periodId, subject.id, { ...input, position }),
        );
      });
    },

    async updateCut(userId: string, id: string, input: UpdateGradingPeriodInput) {
      const cut = await grading.findCut(userId, id);
      if (!cut) throw cutNotFound();
      return write(userId, async (tx, repo) => {
        await trackedPeriod(tx, userId, cut.periodId);
        if (!(await repo.findCut(userId, id))) throw cutNotFound();
        if (
          input.finalShareBp !== undefined &&
          (await repo.sumCutShares(userId, cut.subjectId, id)) + input.finalShareBp > WEIGHT_BP_MAX
        )
          throw weightExceeded('finalShareBp', 'Los cortes');
        return toGradingPeriodDto(await repo.updateCut(userId, id, input));
      });
    },

    /** Never cascades: a cut with evaluations is refused; the evaluations are removed (or moved) first. */
    async removeCut(userId: string, id: string) {
      if (!(await grading.findCut(userId, id))) throw cutNotFound();
      await write(userId, async (_tx, repo) => {
        if ((await repo.countEvaluationsInCut(userId, id)) > 0) throw cutNotEmpty();
        try {
          if (!(await repo.deleteCut(userId, id))) throw cutNotFound();
        } catch (err) {
          // An evaluation was added between the check and the delete: the foreign key still says no.
          if (isPrismaError(err, 'P2003')) throw cutNotEmpty();
          throw err;
        }
      });
    },

    async createEvaluation(userId: string, input: CreateEvaluationInput) {
      const subject = await subjects.findOwned(userId, input.subjectId);
      if (!subject) throw subjectNotFound();
      try {
        return await write(userId, async (tx, repo) => {
          await trackedPeriod(tx, userId, subject.periodId);
          const profile = await repo.findProfile(userId, subject.periodId);
          if (!profile) throw notConfigured();

          const cut = await repo.findCut(userId, input.gradingPeriodId);
          if (!cut) throw cutNotFound();
          if (cut.subjectId !== subject.id)
            throw validationError({ gradingPeriodId: ['El corte debe ser de esta materia.'] });

          // A DIRECT CUT GRADE is the grade of the whole cut; a cut is either that or broken down, never both.
          const isCutGrade = input.isCutGrade === true;
          const usage = await repo.cutUsage(userId, subject.id, cut.id);
          if (isCutGrade) {
            if (usage.direct) throw cutGradeExists();
            if (usage.total > 0) throw cutHasEvaluations();
          } else if (usage.direct) throw cutHasDirectGrade();
          const name = isCutGrade ? cutGradeName(cut.name) : (input.name as string);
          const share = isCutGrade ? 10_000 : (input.periodShareBp as number);

          const activityId = isCutGrade ? null : (input.activityId ?? null);
          if (activityId !== null) await checkActivity(tx, userId, activityId, subject.id);

          if ((await repo.sumEvaluationShares(userId, subject.id, cut.id)) + share > WEIGHT_BP_MAX)
            throw weightExceeded('periodShareBp', 'Las evaluaciones de este corte');

          const score = resolveScore(
            profile,
            input.scoreMilli,
            { earned: input.rawEarnedMilli, max: input.rawMaxMilli },
            null,
          );
          const hasRaw = typeof input.rawEarnedMilli === 'number';
          if ((hasRaw || isCutGrade) && score === null)
            throw validationError({ scoreMilli: ['Indica la nota para guardar lo obtenido.'] });
          return toEvaluationDto(
            await repo.createEvaluation(userId, subject.periodId, {
              subjectId: subject.id,
              gradingPeriodId: cut.id,
              activityId,
              name,
              isCutGrade,
              periodShareBp: share,
              scoreMilli: score,
              rawEarnedMilli: hasRaw ? (input.rawEarnedMilli as number) : null,
              rawMaxMilli: hasRaw ? (input.rawMaxMilli as number) : null,
              scoredAt: score === null ? null : clock(),
            }),
          );
        });
      } catch (err) {
        // A foreign key can fail for the cut, the activity or the subject, and the failed transaction is gone: look again at
        // what the request named and report the one that vanished (never "the cut" by default).
        if (!isPrismaError(err, 'P2003')) throw err;
        if (!(await subjects.findOwned(userId, input.subjectId))) throw subjectNotFound();
        if (!(await grading.findCut(userId, input.gradingPeriodId))) throw cutNotFound();
        if (input.activityId && !(await activities.findOwned(userId, input.activityId)))
          throw activityNotFound();
        throw err;
      }
    },

    async updateEvaluation(userId: string, id: string, input: UpdateEvaluationInput) {
      const found = await grading.findEvaluation(userId, id);
      if (!found) throw evaluationNotFound();
      return write(userId, async (tx, repo) => {
        await trackedPeriod(tx, userId, found.periodId);
        const current = await repo.findEvaluation(userId, id);
        if (!current) throw evaluationNotFound();
        const profile = await repo.findProfile(userId, current.periodId);
        if (!profile) throw notConfigured();

        // The grade of a whole cut only changes its score (its name, weight, cut and activity are not the student's to set).
        if (current.isCutGrade) {
          const fixed = (
            ['name', 'periodShareBp', 'gradingPeriodId', 'activityId'] as const
          ).filter((k) => input[k] !== undefined);
          if (fixed.length > 0)
            throw validationError(
              Object.fromEntries(
                fixed.map((k) => [k, ['La nota de un corte solo cambia su nota.']]),
              ),
            );
          if (input.scoreMilli === null)
            throw validationError({
              scoreMilli: ['Escribe la nota o quita la nota del corte.'],
            });
        }

        let cutId = current.gradingPeriodId;
        if (input.gradingPeriodId !== undefined && input.gradingPeriodId !== cutId) {
          const cut = await repo.findCut(userId, input.gradingPeriodId);
          if (!cut) throw cutNotFound();
          if (cut.subjectId !== current.subjectId)
            throw validationError({ gradingPeriodId: ['El corte debe ser de esta materia.'] });
          if ((await repo.cutUsage(userId, current.subjectId, cut.id)).direct)
            throw cutHasDirectGrade();
          cutId = cut.id;
        }
        const share = input.periodShareBp ?? current.periodShareBp;
        if (
          (input.periodShareBp !== undefined || cutId !== current.gradingPeriodId) &&
          (await repo.sumEvaluationShares(userId, current.subjectId, cutId, id)) + share >
            WEIGHT_BP_MAX
        )
          throw weightExceeded('periodShareBp', 'Las evaluaciones de este corte');

        if (input.activityId) await checkActivity(tx, userId, input.activityId, current.subjectId);

        // The score: absent = unchanged (an "earned/max" pair without a score converts on a 0-based scale); null = clear it,
        // which clears the raw pair with it (a raw pair without a score cannot exist).
        let score: number | null;
        let rawEarned = current.rawEarnedMilli;
        let rawMax = current.rawMaxMilli;
        if (input.scoreMilli === null) {
          score = null;
          rawEarned = null;
          rawMax = null;
        } else {
          score = resolveScore(
            profile,
            input.scoreMilli,
            { earned: input.rawEarnedMilli, max: input.rawMaxMilli },
            current.scoreMilli,
          );
          if (input.rawEarnedMilli !== undefined) {
            rawEarned = input.rawEarnedMilli;
            rawMax = input.rawMaxMilli ?? null;
          }
          if (rawEarned !== null && score === null)
            throw validationError({ scoreMilli: ['Indica la nota para guardar lo obtenido.'] });
        }
        const scoredAt =
          score === null ? null : score !== current.scoreMilli ? clock() : current.scoredAt;
        return toEvaluationDto(
          await repo.updateEvaluation(userId, id, {
            ...(cutId !== current.gradingPeriodId && { gradingPeriodId: cutId }),
            ...(input.activityId !== undefined && { activityId: input.activityId }),
            ...(input.name !== undefined && { name: input.name }),
            ...(input.periodShareBp !== undefined && { periodShareBp: input.periodShareBp }),
            scoreMilli: score,
            rawEarnedMilli: rawEarned,
            rawMaxMilli: rawMax,
            scoredAt,
          }),
        );
      });
    },

    async removeEvaluation(userId: string, id: string) {
      if (!(await grading.deleteEvaluation(userId, id))) throw evaluationNotFound();
    },

    /** The subject's evaluations with the exact figures; `profile: null` (no summary) while the period has no scale. */
    async getSubjectGrades(userId: string, subjectId: string): Promise<SubjectGradesResponse> {
      const subject = await subjects.findOwned(userId, subjectId);
      if (!subject) throw subjectNotFound();
      const period = await periods.findOwned(userId, subject.periodId);
      if (!period) throw subjectNotFound(); // (unreachable: the subject's period always exists)
      const [profile, cuts, evaluations, study] = await Promise.all([
        grading.findProfile(userId, subject.periodId),
        grading.listCuts(userId, subject.id),
        grading.listForSubject(userId, subjectId),
        period.studyTrackId ? studyTracks.findOwned(userId, period.studyTrackId) : null,
      ]);
      let summary: SubjectGradesResponse['summary'] = null;
      // Without cuts there is nothing to add up yet: the subject still has to say how its final grade is split.
      if (profile && cuts.length > 0) {
        const items = evaluations.map((e) => ({
          gradingPeriodId: e.gradingPeriodId,
          periodShareBp: e.periodShareBp,
          scoreMilli: e.scoreMilli,
        }));
        summary = {
          ...summarizeSubjectGrade(profile, cuts, items),
          required: requiredScore(profile, cuts, items),
        };
      }
      return {
        subjectId,
        periodId: subject.periodId,
        period: { id: period.id, name: period.name, studyTrackId: period.studyTrackId },
        studyTrack: study
          ? { id: study.id, name: study.name, type: study.type, status: study.status }
          : null,
        profile: profile ? toGradingProfileDto(profile) : null,
        gradingPeriods: cuts.map(toGradingPeriodDto),
        evaluations: evaluations.map(toEvaluationDto),
        summary,
      };
    },
  };
}

export type GradingService = ReturnType<typeof createGradingService>;
