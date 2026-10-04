import type { AcademicPeriod, Activity, DashboardActivity, Subject } from '@planner/core';
import type {
  AcademicPeriod as PeriodRow,
  Activity as ActivityRow,
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

export const toActivityDto = (a: ActivityRow): Activity => ({
  id: a.id,
  subjectId: a.subjectId,
  title: a.title,
  description: a.description,
  type: a.type,
  priority: a.priority,
  status: a.status,
  dueAt: a.dueAt.toISOString(),
  hasTime: a.hasTime,
  completedAt: a.completedAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

/** An activity row joined with the few subject fields the Dashboard shows (same query, no N+1). */
export const toDashboardActivityDto = (
  a: ActivityRow & { subject: { id: string; name: string; color: string } },
): DashboardActivity => ({ ...toActivityDto(a), subject: a.subject });

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
