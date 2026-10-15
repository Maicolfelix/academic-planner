import {
  dedupeSubjectNames,
  pickSubjectColor,
  type EducationContext,
  type SubjectBatchResponse,
} from '@planner/core';
import type { Db } from '../db/prisma.js';
import { toSubjectDto } from '../mappers.js';
import { createPeriodLookup } from '../repositories/periodRepository.js';
import { createProfileRepository } from '../repositories/profileRepository.js';
import { createSubjectRepository } from '../repositories/subjectRepository.js';
import { createSubjectMaterializer } from './subjectMaterializer.js';

/**
 * Creates (or reuses) the subjects NAMED `names` in ONE period, inside the transaction `tx` the caller already holds: the part
 * the quick batch and the study setup share. The period is already decided (and owned) by the caller; the client never sends
 * colors or a context here. A name the period already has is REUSED as it is (never an error), names that normalize to the same
 * key are one subject, and the answer keeps the order in which the names first appear. Colors follow the INPUT order, from the
 * ones the period does not use yet; new subjects are inserted in key order (a fixed order for every request). The
 * (periodId, nameKey) unique index stays the source of truth for concurrent requests.
 *
 * `educationContext` undefined = the context of the period's study, else the default of the primary use (the materializer).
 */
export async function createNamedSubjects(
  tx: Db,
  userId: string,
  periodId: string,
  names: readonly string[],
  educationContext?: EducationContext | null,
): Promise<SubjectBatchResponse> {
  const subjects = createSubjectRepository(tx);
  const materializer = createSubjectMaterializer(
    subjects,
    createProfileRepository(tx),
    createPeriodLookup(tx),
    { readOnce: true },
  );

  const wanted = dedupeSubjectNames(names);
  const existing = await subjects.list(userId, periodId);
  const byKey = new Map(existing.map((s) => [s.nameKey, s]));
  const usedColors = existing.map((s) => s.color);
  const resolved = new Map<string, Parameters<typeof toSubjectDto>[0]>();
  const created = new Set<string>();

  const pending = wanted.filter((w) => !byKey.has(w.key)).sort((a, b) => (a.key < b.key ? -1 : 1));
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
      periodId,
      name: w.name,
      nameKey: w.key,
      color: colorOf.get(w.key)!,
      professor: null,
      description: null,
      educationContext,
    });
    resolved.set(w.key, subject);
    if (wasCreated) created.add(w.key);
  }

  const ordered = wanted.map((w) => ({ key: w.key, row: resolved.get(w.key)! }));
  return {
    subjects: ordered.map((o) => toSubjectDto(o.row)),
    createdSubjects: ordered.filter((o) => created.has(o.key)).map((o) => toSubjectDto(o.row)),
    reusedSubjects: ordered
      .filter((o) => !created.has(o.key))
      .map((o) => ({ id: o.row.id, name: o.row.name })),
  };
}
