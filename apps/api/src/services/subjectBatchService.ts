import type { CreateSubjectBatchInput, SubjectBatchResponse } from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { createNamedSubjects } from './subjectNames.js';

/**
 * Quick setup: several subjects in ONE transaction, in the user's HOME current period (a general one, else the primary study's;
 * the client never says which). It stays on HOME on purpose (onboarding is its only caller): a subject in another study's period
 * is created one at a time through `POST /api/subjects` with an explicit `periodId`, or together with a new study by
 * `POST /api/study-tracks/setup`. The rules of the names (reuse, de-duplication, order, colors) live in `createNamedSubjects`.
 */
export function createSubjectBatchService(opts: { runInTransaction: RunInTransaction }) {
  return {
    async create(userId: string, input: CreateSubjectBatchInput): Promise<SubjectBatchResponse> {
      return opts.runInTransaction(async (tx) => {
        // One batch of a user at a time: two requests naming the same subjects in another order would otherwise wait on
        // each other's inserts.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`subject-batch:${userId}`}, 0))`;

        const period = await createPeriodLookup(tx).findHomeCurrent(userId);
        if (!period) {
          throw new AppError(
            400,
            'NO_CURRENT_PERIOD',
            'Configura tu periodo académico antes de agregar asignaturas.',
          );
        }
        return createNamedSubjects(tx, userId, period.id, input.names, input.educationContext);
      });
    },
  };
}

export type SubjectBatchService = ReturnType<typeof createSubjectBatchService>;
