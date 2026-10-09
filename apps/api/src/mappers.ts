import {
  toLocalParts,
  weekdayOf,
  type AcademicPeriod,
  type Activity,
  type BlockOccurrence,
  type DashboardActivity,
  type DueReminder,
  type Reminder,
  type ScheduleBlock,
  type ScheduleBlockLike,
  type ScheduleOccurrence,
  type Subject,
} from '@planner/core';
import type {
  AcademicPeriod as PeriodRow,
  Activity as ActivityRow,
  Reminder as ReminderRow,
  ScheduleBlock as ScheduleRow,
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

export const toReminderDto = (r: ReminderRow): Reminder => ({
  id: r.id,
  activityId: r.activityId,
  remindAt: r.remindAt.toISOString(),
  kind: r.kind,
  status: r.status,
  offsetMinutes: r.offsetMinutes,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** A reminder joined with its activity and subject: what the UI needs to write the message. */
export const toDueReminderDto = (
  r: ReminderRow & {
    activity: {
      id: string;
      title: string;
      type: ActivityRow['type'];
      dueAt: Date;
      hasTime: boolean;
      subject: { id: string; name: string; color: string } | null;
    };
  },
): DueReminder => ({
  ...toReminderDto(r),
  activity: {
    id: r.activity.id,
    title: r.activity.title,
    type: r.activity.type,
    dueAt: r.activity.dueAt.toISOString(),
    hasTime: r.activity.hasTime,
  },
  subject: r.activity.subject,
});

/** A schedule block row joined with its subject and the period's days (one query, no N+1). */
export type ScheduleBlockRow = ScheduleRow & {
  subject: { id: string; name: string; color: string } | null;
  period: { startDate: Date; endDate: Date };
};

/** The stored block, with its first occurrence expressed on the user's wall clock. */
export const toScheduleBlockDto = (row: ScheduleBlockRow, timeZone: string): ScheduleBlock => {
  const start = toLocalParts(row.startAt, timeZone);
  const end = toLocalParts(row.endAt, timeZone);
  return {
    id: row.id,
    periodId: row.periodId,
    subjectId: row.subjectId,
    subject: row.subject,
    title: row.title,
    type: row.type,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    recurrence:
      row.recurrenceType === 'WEEKLY' && row.recurrenceUntil
        ? {
            frequency: 'WEEKLY',
            weekday: weekdayOf(start.date),
            until: toDateOnly(row.recurrenceUntil),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** What the expansion function needs from a stored block (including its period's days as bounds). */
export const toBlockLike = (row: ScheduleBlockRow): ScheduleBlockLike => ({
  startAt: row.startAt,
  endAt: row.endAt,
  recurrenceUntil:
    row.recurrenceType === 'WEEKLY' && row.recurrenceUntil ? toDateOnly(row.recurrenceUntil) : null,
  bounds: { from: toDateOnly(row.period.startDate), to: toDateOnly(row.period.endDate) },
});

export const toOccurrenceDto = (
  row: ScheduleBlockRow,
  occurrence: BlockOccurrence,
  hasConflict: boolean,
): ScheduleOccurrence => ({
  blockId: row.id,
  periodId: row.periodId,
  occurrenceDate: occurrence.date,
  startAt: occurrence.startAt.toISOString(),
  endAt: occurrence.endAt.toISOString(),
  title: row.title,
  type: row.type,
  subject: row.subject,
  isRecurring: row.recurrenceType === 'WEEKLY',
  hasConflict,
});

/** An activity row joined with the few subject fields the Dashboard shows (same query, no N+1). */
export const toDashboardActivityDto = (
  a: ActivityRow & { subject: { id: string; name: string; color: string } | null },
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
