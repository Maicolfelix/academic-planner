import {
  END_AFTER_START_ERROR,
  isEndAfterStart,
  type CreatePeriodInput,
  type UpdatePeriodInput,
} from '@planner/core';
import { AppError, notFound, validationError } from '../errors/AppError.js';
import { Prisma } from '../generated/prisma/client.js';
import { toDateOnly, toPeriodDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';

const periodNotFound = () => notFound('Periodo no encontrado.');

const isPrismaError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const notEmpty = () =>
  new AppError(
    409,
    'PERIOD_NOT_EMPTY',
    'Este periodo todavía tiene asignaturas o bloques de agenda. Elimínalos primero para poder borrarlo.',
  );

export function createPeriodService(periods: PeriodRepository) {
  return {
    async list(userId: string) {
      return (await periods.list(userId)).map(toPeriodDto);
    },

    async get(userId: string, id: string) {
      const period = await periods.findOwned(userId, id);
      if (!period) throw periodNotFound();
      return toPeriodDto(period);
    },

    /** The user's first period is always the current one; later ones only if asked. */
    async create(userId: string, input: CreatePeriodInput) {
      const makeCurrent = input.isCurrent === true || !(await periods.hasCurrent(userId));
      try {
        const { name, startDate, endDate } = input;
        return toPeriodDto(await periods.create(userId, { name, startDate, endDate }, makeCurrent));
      } catch (err) {
        // Two simultaneous "make current" requests: the partial unique index lets only one win.
        if (isPrismaError(err, 'P2002')) throw conflictingCurrent();
        throw err;
      }
    },

    async update(userId: string, id: string, input: UpdatePeriodInput) {
      const existing = await periods.findOwned(userId, id);
      if (!existing) throw periodNotFound();

      // The schema only compares dates present in the request; the other half comes from storage.
      const startDate = input.startDate ?? toDateOnly(existing.startDate);
      const endDate = input.endDate ?? toDateOnly(existing.endDate);
      if (!isEndAfterStart(startDate, endDate)) {
        throw validationError({ endDate: [END_AFTER_START_ERROR] });
      }

      try {
        const { name, startDate: s, endDate: e } = input;
        const updated = await periods.update(
          userId,
          id,
          { name, startDate: s, endDate: e },
          input.isCurrent === true,
        );
        return toPeriodDto(updated);
      } catch (err) {
        if (isPrismaError(err, 'P2025')) throw periodNotFound();
        if (isPrismaError(err, 'P2002')) throw conflictingCurrent();
        throw err;
      }
    },

    /** Never cascades: a period with subjects must be emptied by the user first. */
    async remove(userId: string, id: string) {
      if (!(await periods.findOwned(userId, id))) throw periodNotFound();
      // Subjects AND standalone schedule blocks (a study session has no subject but has a period).
      const [subjectCount, blockCount] = await Promise.all([
        periods.countSubjects(id),
        periods.countScheduleBlocks(id),
      ]);
      if (subjectCount > 0 || blockCount > 0) throw notEmpty();
      try {
        if (!(await periods.delete(userId, id))) throw periodNotFound();
      } catch (err) {
        // A subject was added between the check and the delete: the foreign key still says no.
        if (isPrismaError(err, 'P2003')) throw notEmpty();
        throw err;
      }
    },
  };
}

const conflictingCurrent = () =>
  new AppError(409, 'CONFLICT', 'Otra solicitud cambió el periodo actual. Inténtalo de nuevo.');

export type PeriodService = ReturnType<typeof createPeriodService>;
