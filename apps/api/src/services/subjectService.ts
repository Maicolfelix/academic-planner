import { normalizeNameKey, type CreateSubjectInput, type UpdateSubjectInput } from '@planner/core';
import { AppError, notFound } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toSubjectDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';

const subjectNotFound = () => notFound('Asignatura no encontrada.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const duplicate = () =>
  new AppError(
    409,
    'SUBJECT_ALREADY_EXISTS',
    'Ya tienes una asignatura con ese nombre en este periodo.',
    { fields: { name: ['Ya tienes una asignatura con ese nombre en este periodo.'] } },
  );

export function createSubjectService(subjects: SubjectRepository, periods: PeriodRepository) {
  return {
    list: async (userId: string, periodId?: string) =>
      (await subjects.list(userId, periodId)).map(toSubjectDto),

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
      try {
        const created = await subjects.create({
          userId,
          periodId: input.periodId,
          name: input.name,
          nameKey: normalizeNameKey(input.name),
          color: input.color,
          professor: input.professor ?? null,
          description: input.description ?? null,
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

    async remove(userId: string, id: string) {
      // Phase 4 will add activities: this is where "has activities" rules will live.
      if (!(await subjects.delete(userId, id))) throw subjectNotFound();
    },
  };
}

export type SubjectService = ReturnType<typeof createSubjectService>;
