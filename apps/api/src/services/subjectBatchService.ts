import {
  dedupeSubjectNames,
  pickSubjectColor,
  type CreateSubjectBatchInput,
  type SubjectBatchResponse,
} from '@planner/core';
import type { RunInTransaction } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { toSubjectDto } from '../mappers.js';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { createProfileRepository } from '../repositories/profileRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { createSubjectMaterializer } from './subjectMaterializer.js';

/**
 * Quick setup: several subjects in ONE transaction, in the user's HOME current period (a general one, else the primary study's; the client never says which). Transitional: it cannot yet
 * target another study's period (a later step gives that its own flow). A name the
 * period already has is REUSED as it is (never an error), names that normalize to the same key are one subject, and the
 * answer keeps the order in which the names first appear. Colors are assigned by the server, one after another, from the ones
 * the period does not use yet. The (periodId, nameKey) unique index stays the source of truth for concurrent requests.
 */
export function createSubjectBatchService(opts: { runInTransaction: RunInTransaction }) {
  return {
    async create(userId: string, input: CreateSubjectBatchInput): Promise<SubjectBatchResponse> {
      return opts.runInTransaction(async (tx) => {
        const periods = createPeriodLookup(tx);
        const subjects = createSubjectRepository(tx);
        const materializer = createSubjectMaterializer(
          subjects,
          createProfileRepository(tx),
          periods,
          {
            readOnce: true,
          },
        );

        // One batch of a user at a time: two requests naming the same subjects in another order would otherwise wait on
        // each other's inserts.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`subject-batch:${userId}`}, 0))`;

        const period = await periods.findHomeCurrent(userId);
        if (!period) {
          throw new AppError(
            400,
            'NO_CURRENT_PERIOD',
            'Configura tu periodo académico antes de agregar asignaturas.',
          );
        }

        const wanted = dedupeSubjectNames(input.names);
        const existing = await subjects.list(userId, period.id);
        const byKey = new Map(existing.map((s) => [s.nameKey, s]));
        const usedColors = existing.map((s) => s.color);
        const resolved = new Map<string, Parameters<typeof toSubjectDto>[0]>();
        const created = new Set<string>();

        // New subjects are inserted in key order (a fixed order for every request); the answer is put back in input order.
        const pending = wanted
          .filter((w) => !byKey.has(w.key))
          .sort((a, b) => (a.key < b.key ? -1 : 1));
        // ...but colors follow the INPUT order, so the first name written gets the first free color.
        const colorOf = new Map<string, string>();
        for (const w of wanted) {
          if (byKey.has(w.key)) continue;
          const color = pickSubjectColor(usedColors);
          usedColors.push(color);
          colorOf.set(w.key, color);
        }

        for (const w of wanted) if (byKey.has(w.key)) resolved.set(w.key, byKey.get(w.key)!);
        for (const w of pending) {
          const { subject, created: wasCreated } = await materializer.createIfAbsent({
            userId,
            periodId: period.id,
            name: w.name,
            nameKey: w.key,
            color: colorOf.get(w.key)!,
            professor: null,
            description: null,
            educationContext: input.educationContext,
          });
          resolved.set(w.key, subject);
          if (wasCreated) created.add(w.key);
        }

        const ordered = wanted.map((w) => ({ key: w.key, row: resolved.get(w.key)! }));
        return {
          subjects: ordered.map((o) => toSubjectDto(o.row)),
          createdSubjects: ordered
            .filter((o) => created.has(o.key))
            .map((o) => toSubjectDto(o.row)),
          reusedSubjects: ordered
            .filter((o) => !created.has(o.key))
            .map((o) => ({ id: o.row.id, name: o.row.name })),
        };
      });
    },
  };
}

export type SubjectBatchService = ReturnType<typeof createSubjectBatchService>;
