import { normalizeNameKey, type CreateSubjectInput, type UpdateSubjectInput } from '@planner/core';
import { AppError, notFound } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toSubjectDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import { readCurrentPeriods } from './currentPeriods.js';
import type { SubjectMaterializer } from './subjectMaterializer.js';

const subjectNotFound = () => notFound('Asignatura no encontrada.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

/** Counts are included when known (the foreign-key race path does not have them). */
const notEmpty = (dependents?: { activities: number; scheduleBlocks: number }) =>
  new AppError(
    409,
    'SUBJECT_NOT_EMPTY',
    'La asignatura tiene actividades o bloques de agenda asociados.',
    dependents,
  );

const hasEvaluations = () =>
  new AppError(
    409,
    'SUBJECT_HAS_EVALUATIONS',
    'La asignatura tiene evaluaciones o notas registradas. Elimínalas primero.',
  );

const duplicate = () =>
  new AppError(
    409,
    'SUBJECT_ALREADY_EXISTS',
    'Ya tienes una asignatura con ese nombre en este periodo.',
    { fields: { name: ['Ya tienes una asignatura con ese nombre en este periodo.'] } },
  );

export function createSubjectService(
  subjects: SubjectRepository,
  periods: PeriodRepository,
  materializer: SubjectMaterializer,
) {
  return {
    list: async (userId: string, periodId?: string) =>
      (await subjects.list(userId, periodId)).map(toSubjectDto),

    /** The subjects of ALL the current, active periods (`scope=current`): one lookup of the periods, one query of subjects. */
    async listCurrent(userId: string) {
      const current = await readCurrentPeriods(periods, userId);
      if (current.ids.length === 0) return [];
      return (await subjects.listInPeriods(userId, current.ids)).map(toSubjectDto);
    },

    async get(userId: string, id: string) {
      const subject = await subjects.findOwned(userId, id);
      if (!subject) throw subjectNotFound();
      return toSubjectDto(subject);
    },

    /**
     * The period must belong to the authenticated user. A period that does not exist and one that
     * belongs to someone else produce the very same 404.
     */
    async create(userId: string, input: CreateSubjectInput) {
      if (!(await periods.findOwned(userId, input.periodId)))
        throw notFound('Periodo no encontrado.');
      // An explicit context (even null) is used as given; omitted, it is the type of the period's study or, for a general period, the
      // default of the profile primary use.
      const educationContext = await materializer.contextFor(
        userId,
        input.educationContext,
        input.periodId,
      );
      try {
        const created = await subjects.create({
          userId,
          periodId: input.periodId,
          name: input.name,
          nameKey: normalizeNameKey(input.name),
          color: input.color,
          professor: input.professor ?? null,
          description: input.description ?? null,
          educationContext,
        });
        return toSubjectDto(created);
      } catch (err) {
        // (periodId, nameKey) is unique in the database, so concurrent duplicates are caught too.
        if (isPrismaError(err, 'P2002')) throw duplicate();
        throw err;
      }
    },

    async update(userId: string, id: string, input: UpdateSubjectInput) {
      if (!(await subjects.findOwned(userId, id))) throw subjectNotFound();
      try {
        const updated = await subjects.update(userId, id, {
          ...input,
          ...(input.name !== undefined && { nameKey: normalizeNameKey(input.name) }),
        });
        return toSubjectDto(updated);
      } catch (err) {
        if (isPrismaError(err, 'P2025')) throw subjectNotFound();
        if (isPrismaError(err, 'P2002')) throw duplicate();
        throw err;
      }
    },

    /** Never cascades: a subject with activities or schedule blocks must be emptied (or they moved) first. */
    async remove(userId: string, id: string) {
      if (!(await subjects.findOwned(userId, id))) throw subjectNotFound();
      const dependents = await subjects.countDependents(id);
      if (dependents.activities > 0 || dependents.scheduleBlocks > 0) throw notEmpty(dependents);
      if ((await subjects.countEvaluations(userId, id)) > 0) throw hasEvaluations();
      try {
        if (!(await subjects.delete(userId, id))) throw subjectNotFound();
      } catch (err) {
        // An activity was added between the check and the delete: the foreign key still says no.
        if (isPrismaError(err, 'P2003'))
          throw (await subjects.countEvaluations(userId, id)) > 0 ? hasEvaluations() : notEmpty();
        throw err;
      }
    },
  };
}

export type SubjectService = ReturnType<typeof createSubjectService>;
