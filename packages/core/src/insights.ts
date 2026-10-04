import { z } from 'zod';
import { periodSchema, dateOnlySchema, type DateOnly } from './academic.js';
import type { ActivityStatus } from './activity.js';
import { WEEKDAYS, addDays, weekdayOf, type Weekday } from './calendar.js';
import { calculateProgress } from './dashboard.js';
import type { ScheduleBlockType } from './schedule.js';
import { toLocalParts } from './time.js';

/**
 * PROGRESS and WEEKLY WORKLOAD: two descriptive views derived from what the student registered.
 *
 * Neither is performance, productivity, stress or risk: the app has no data to measure those. "Progress" is the
 * share of registered activities that are finished; "workload" is how many registered commitments (activities and
 * agenda blocks) fall in a week and how many scheduled hours the agenda holds. Nothing here is stored.
 * See docs/progress-and-workload.md.
 */

// ───────────────────────── Progress ─────────────────────────

export interface StatusCounts {
  pending: number;
  inProgress: number;
  completed: number;
}

export interface ProgressSummary extends StatusCounts {
  total: number;
  /** Open and past their deadline. Also counted in `pending` / `inProgress`: overdue is not a status. */
  overdue: number;
  /** completed / total as a whole percent (the same rule as the Dashboard). 0 when there are no activities. */
  percentage: number;
}

/**
 * Progress of one set of activities. Unweighted: a finished activity counts as one, whatever its priority,
 * type or subject. With no activities the percentage is 0 but `total` is 0 too, so a screen can say
 * "Sin actividades registradas" instead of presenting 0 % as bad progress.
 */
export function calculateSubjectProgress(counts: StatusCounts, overdue: number): ProgressSummary {
  const total = counts.pending + counts.inProgress + counts.completed;
  return {
    total,
    pending: counts.pending,
    inProgress: counts.inProgress,
    completed: counts.completed,
    overdue,
    percentage: calculateProgress(counts.completed, total),
  };
}

export interface SubjectProgressInput {
  id: string;
  name: string;
  color: string;
  counts: StatusCounts;
  overdue: number;
}

export type SubjectProgress = ProgressSummary & { id: string; name: string; color: string };

/**
 * General progress (all the period's activities) and progress per subject, sorted alphabetically: a stable,
 * neutral order that does not rank subjects by how well they are going.
 */
export function buildProgress(subjects: readonly SubjectProgressInput[]): {
  general: ProgressSummary;
  subjects: SubjectProgress[];
} {
  const sum = (pick: (s: SubjectProgressInput) => number) =>
    subjects.reduce((acc, s) => acc + pick(s), 0);
  const general = calculateSubjectProgress(
    {
      pending: sum((s) => s.counts.pending),
      inProgress: sum((s) => s.counts.inProgress),
      completed: sum((s) => s.counts.completed),
    },
    sum((s) => s.overdue),
  );
  const sorted = [...subjects].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return {
    general,
    subjects: sorted.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      ...calculateSubjectProgress(s.counts, s.overdue),
    })),
  };
}

// ───────────────────────── Weekly workload ─────────────────────────

export interface WorkloadActivity {
  dueAt: Date | string;
  status: ActivityStatus;
}

export interface WorkloadOccurrence {
  /** Local day the occurrence starts on (YYYY-MM-DD). */
  occurrenceDate: DateOnly;
  startAt: Date | string;
  endAt: Date | string;
  type: ScheduleBlockType;
}

export interface WorkloadDay {
  date: DateOnly;
  weekday: Weekday;
  activityCount: number;
  scheduleCount: number;
  scheduledMinutes: number;
  totalCommitments: number;
}

export interface WeeklyWorkload {
  /** Monday and Sunday of the week (local dates). */
  week: { from: DateOnly; to: DateOnly };
  totals: {
    /** Activities whose deadline falls in the week, whatever their status (a finished one still belongs to it). */
    activityCount: number;
    activitiesByStatus: StatusCounts;
    /** pending + inProgress */
    openActivityCount: number;
    classCount: number;
    studyBlockCount: number;
    otherAcademicBlockCount: number;
    /** Every agenda occurrence of the week (a weekly series counts once per week it appears in). */
    scheduleOccurrenceCount: number;
    /** activityCount + scheduleOccurrenceCount */
    totalCommitments: number;
    /** Sum of the real duration (endAt − startAt) of the occurrences. Activities add no hours. */
    scheduledMinutes: number;
  };
  days: WorkloadDay[];
  busiestDay: {
    date: DateOnly;
    weekday: Weekday;
    totalCommitments: number;
    scheduledMinutes: number;
  } | null;
}

/**
 * The day with the most commitments. Ties go to the day with more scheduled minutes, then to the earlier day of
 * the week. null when the week has no commitments at all (there is no "busiest" day to name).
 */
export function selectBusiestDay(days: readonly WorkloadDay[]): WeeklyWorkload['busiestDay'] {
  let best: WorkloadDay | undefined;
  for (const day of days) {
    if (day.totalCommitments === 0) continue;
    if (
      !best ||
      day.totalCommitments > best.totalCommitments ||
      (day.totalCommitments === best.totalCommitments &&
        day.scheduledMinutes > best.scheduledMinutes)
    ) {
      best = day; // days arrive Monday -> Sunday, so keeping the first of equals picks the earliest
    }
  }
  return best
    ? {
        date: best.date,
        weekday: best.weekday,
        totalCommitments: best.totalCommitments,
        scheduledMinutes: best.scheduledMinutes,
      }
    : null;
}

const minutesOf = (o: WorkloadOccurrence) =>
  Math.round((new Date(o.endAt).getTime() - new Date(o.startAt).getTime()) / 60_000);

/**
 * The week's commitments, Monday to Sunday of `weekFrom`, on the user's local calendar (never UTC):
 *  - an Activity counts on the local day of its `dueAt`, in any status; one that is overdue from ANOTHER week
 *    does not count here just because it is still open;
 *  - an agenda occurrence counts on the local day it STARTS (its minutes too, even if it ends after midnight);
 *    overlapping occurrences all count — nothing is merged or subtracted;
 *  - an Activity has no known duration: it is one commitment and adds no hours.
 * Anything outside the week is ignored here, so the boundaries live in this one place.
 */
export function buildWeeklyWorkload(input: {
  weekFrom: DateOnly;
  activities: readonly WorkloadActivity[];
  occurrences: readonly WorkloadOccurrence[];
  timeZone: string;
}): WeeklyWorkload {
  const { weekFrom, timeZone } = input;
  const dates = WEEKDAYS.map((_, i) => addDays(weekFrom, i));
  const byDate = new Map<DateOnly, WorkloadDay>(
    dates.map((date) => [
      date,
      {
        date,
        weekday: weekdayOf(date),
        activityCount: 0,
        scheduleCount: 0,
        scheduledMinutes: 0,
        totalCommitments: 0,
      },
    ]),
  );

  const byStatus: StatusCounts = { pending: 0, inProgress: 0, completed: 0 };
  for (const activity of input.activities) {
    const day = byDate.get(toLocalParts(activity.dueAt, timeZone).date);
    if (!day) continue;
    day.activityCount += 1;
    if (activity.status === 'PENDING') byStatus.pending += 1;
    else if (activity.status === 'IN_PROGRESS') byStatus.inProgress += 1;
    else byStatus.completed += 1;
  }

  const byType: Record<ScheduleBlockType, number> = { CLASS: 0, STUDY: 0, ACADEMIC_PERSONAL: 0 };
  let scheduleCount = 0;
  let scheduledMinutes = 0;
  for (const occurrence of input.occurrences) {
    const day = byDate.get(occurrence.occurrenceDate);
    if (!day) continue;
    const minutes = minutesOf(occurrence);
    day.scheduleCount += 1;
    day.scheduledMinutes += minutes;
    byType[occurrence.type] += 1;
    scheduleCount += 1;
    scheduledMinutes += minutes;
  }

  const days = dates.map((date) => {
    const day = byDate.get(date)!;
    return { ...day, totalCommitments: day.activityCount + day.scheduleCount };
  });
  const activityCount = byStatus.pending + byStatus.inProgress + byStatus.completed;

  return {
    week: { from: dates[0]!, to: dates[6]! },
    totals: {
      activityCount,
      activitiesByStatus: byStatus,
      openActivityCount: byStatus.pending + byStatus.inProgress,
      classCount: byType.CLASS,
      studyBlockCount: byType.STUDY,
      otherAcademicBlockCount: byType.ACADEMIC_PERSONAL,
      scheduleOccurrenceCount: scheduleCount,
      totalCommitments: activityCount + scheduleCount,
      scheduledMinutes,
    },
    days,
    busiestDay: selectBusiestDay(days),
  };
}

/** 750 -> "12 h 30 min", 120 -> "2 h", 45 -> "45 min", 0 -> "0 min". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ───────────────────────── Schemas ─────────────────────────

const count = z.number().int().nonnegative();
const weekday = z.number().int().min(1).max(7);

const progressSummaryShape = {
  total: count,
  pending: count,
  inProgress: count,
  completed: count,
  overdue: count,
  percentage: z.number().int().min(0).max(100),
};

/** GET /api/progress: the CURRENT period of the user. `subjects` is alphabetical and includes empty ones. */
export const progressSchema = z.object({
  generatedAt: z.iso.datetime(),
  /** null when the user has not set up a period yet. */
  period: periodSchema.nullable(),
  general: z.object(progressSummaryShape),
  subjects: z.array(
    z.object({ id: z.uuid(), name: z.string(), color: z.string(), ...progressSummaryShape }),
  ),
});
export const progressResponseSchema = z.object({ progress: progressSchema });

/** `week` is ANY date of the wanted week (same meaning as /calendar?week=); omitted = the current local week. */
export const workloadQuerySchema = z.object({ week: dateOnlySchema.optional() });

const workloadDaySchema = z.object({
  date: z.string(),
  weekday,
  activityCount: count,
  scheduleCount: count,
  scheduledMinutes: count,
  totalCommitments: count,
});

export const workloadSchema = z.object({
  generatedAt: z.iso.datetime(),
  period: periodSchema.nullable(),
  week: z.object({ from: z.string(), to: z.string() }),
  totals: z.object({
    activityCount: count,
    activitiesByStatus: z.object({ pending: count, inProgress: count, completed: count }),
    openActivityCount: count,
    classCount: count,
    studyBlockCount: count,
    otherAcademicBlockCount: count,
    scheduleOccurrenceCount: count,
    totalCommitments: count,
    scheduledMinutes: count,
  }),
  days: z.array(workloadDaySchema).length(7),
  busiestDay: z
    .object({ date: z.string(), weekday, totalCommitments: count, scheduledMinutes: count })
    .nullable(),
});
export const workloadResponseSchema = z.object({ workload: workloadSchema });

export type Progress = z.infer<typeof progressSchema>;
export type Workload = z.infer<typeof workloadSchema>;
export type WorkloadQuery = z.infer<typeof workloadQuerySchema>;
