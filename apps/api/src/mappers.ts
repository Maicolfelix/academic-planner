import type { AcademicPeriod, Subject } from '@planner/core';
import type {
  AcademicPeriod as PeriodRow,
  Subject as SubjectRow,
} from './generated/prisma/client.js';

/**
 * Prisma returns @db.Date columns as a Date at UTC midnight; reading the UTC date part gives back
 * exactly the stored calendar day regardless of the server's timezone.
 */
export const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDateOnly = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

export const toPeriodDto = (p: PeriodRow): AcademicPeriod => ({
  id: p.id,
  name: p.name,
  startDate: toDateOnly(p.startDate),
  endDate: toDateOnly(p.endDate),
  isCurrent: p.isCurrent,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** Deliberately omits userId and nameKey: internal details the client has no use for. */
export const toSubjectDto = (s: SubjectRow): Subject => ({
  id: s.id,
  periodId: s.periodId,
  name: s.name,
  professor: s.professor,
  color: s.color,
  description: s.description,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
