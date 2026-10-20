import {
  buildProgress,
  buildSubjectGradeProgress,
  type Progress,
  type StatusCounts,
} from '@planner/core';
import type { GradingRepository } from '../repositories/gradingRepository.js';
import type { InsightsRepository } from '../repositories/insightsRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';

const empty = (): StatusCounts => ({ pending: 0, inProgress: 0, completed: 0 });
const noSubject = () => ({ counts: empty(), overdue: 0 });
const STATUS_KEY = {
  PENDING: 'pending',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
} as const;

/**
 * Registered-activity progress over ALL the authenticated user's current, active periods: `general` counts every activity of
 * all of them (with or without a subject), `byPeriod` splits it one entry per period with its study (so two studies are never
 * shown as one mixed semester), and `subjects` lists every subject of those periods with the period it belongs to.
 * 4 queries (the current periods, then subjects + counts by period/subject/status + overdue counts in parallel), whatever the
 * data or the number of periods. The arithmetic is core's `buildProgress`, once per period and once overall; nothing is stored.
 * The counts are of activities, never a grade or an average. Each subject also carries its academic grade (`grade`, apart from
 * the activities: they are never merged into one figure), from 3 more queries for ALL the subjects, and null when its period has
 * no scale or the subject has no cuts.
 */
export function createProgressService(
  insights: InsightsRepository,
  periods: PeriodRepository,
  grading: GradingRepository,
  clock: () => Date,
) {
  return {
    async get(actor: Actor): Promise<Progress> {
      const now = clock();
      const generatedAt = now.toISOString();
      const current = await readCurrentPeriods(periods, actor.id);
      if (current.ids.length === 0) {
        const { general } = buildProgress([]);
        return { generatedAt, period: null, general, byPeriod: [], subjects: [] };
      }

      const [subjects, statusRows, overdueRows, gradeData] = await Promise.all([
        insights.subjects(actor.id, current.ids),
        insights.statusCounts(actor.id, current.ids),
        insights.overdueCounts(actor.id, current.ids, now),
        grading.progressData(actor.id, current.ids),
      ]);

      // The general activities (no subject) have no row of their own: they only weigh in the general progress (overall and
      // of their period). An activity is counted once: by the period it stores, in one grouped row per status.
      const counts = new Map<string, StatusCounts>();
      const generalOf = new Map<string, ReturnType<typeof noSubject>>();
      const general = (periodId: string) => {
        const g = generalOf.get(periodId) ?? noSubject();
        generalOf.set(periodId, g);
        return g;
      };
      for (const row of statusRows) {
        if (row.subjectId === null) {
          general(row.periodId).counts[STATUS_KEY[row.status]] += row._count._all;
          continue;
        }
        const c = counts.get(row.subjectId) ?? empty();
        c[STATUS_KEY[row.status]] += row._count._all;
        counts.set(row.subjectId, c);
      }
      const overdue = new Map<string, number>();
      for (const row of overdueRows) {
        if (row.subjectId === null) general(row.periodId).overdue += row._count._all;
        else overdue.set(row.subjectId, row._count._all);
      }

      const inputs = subjects.map((s) => ({
        id: s.id,
        periodId: s.periodId,
        name: s.name,
        color: s.color,
        counts: counts.get(s.id) ?? empty(),
        overdue: overdue.get(s.id) ?? 0,
      }));
      const allGeneral = noSubject();
      for (const g of generalOf.values()) {
        allGeneral.counts.pending += g.counts.pending;
        allGeneral.counts.inProgress += g.counts.inProgress;
        allGeneral.counts.completed += g.counts.completed;
        allGeneral.overdue += g.overdue;
      }

      const overall = buildProgress(inputs, allGeneral);
      const periodOf = new Map(inputs.map((s) => [s.id, s.periodId]));
      return {
        generatedAt,
        period: current.home,
        general: overall.general,
        byPeriod: current.contexts.map((context) => ({
          ...context,
          general: buildProgress(
            inputs.filter((s) => s.periodId === context.period.id),
            generalOf.get(context.period.id) ?? noSubject(),
          ).general,
        })),
        subjects: overall.subjects.map((s) => {
          const periodId = periodOf.get(s.id)!;
          const scale = gradeData.profiles.find((p) => p.periodId === periodId) ?? null;
          return {
            ...s,
            periodId,
            // Each subject is read with ITS OWN cuts and evaluations (two subjects, even of one period, split differently).
            grade: buildSubjectGradeProgress(
              scale,
              gradeData.cuts.filter((c) => c.subjectId === s.id),
              gradeData.evaluations
                .filter((e) => e.subjectId === s.id)
                .map((e) => ({
                  gradingPeriodId: e.gradingPeriodId,
                  periodShareBp: e.periodShareBp,
                  scoreMilli: e.scoreMilli,
                  isCutGrade: e.isCutGrade,
                })),
            ),
          };
        }),
      };
    },
  };
}

export type ProgressService = ReturnType<typeof createProgressService>;
