import {
  RADAR_GROUP_LIMIT,
  RADAR_KEYS,
  buildGradeContext,
  calculateRadarStatus,
  type Radar,
} from '@planner/core';
import { toDashboardActivityDto } from '../mappers.js';
import type { GradingRepository } from '../repositories/gradingRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { RadarRepository } from '../repositories/radarRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';

const zeroCounts = () => ({ overdue: 0, immediate: 0, upcoming: 0, plannable: 0, underControl: 0 });
const emptyGroups = (): Radar['groups'] => ({
  overdue: [],
  immediate: [],
  upcoming: [],
  plannable: [],
  underControl: [],
});

/**
 * Academic Radar of the authenticated user over ALL their current, active periods (every one counts the same: the primary
 * study gets no priority). 2 queries: the current periods and the open activities of all of them (one `IN`, joined with their
 * subject). Classification is `calculateRadarStatus` from core — the rule is never repeated here. Nothing is stored; `clock`
 * is injected so every boundary is testable.
 *
 * Grade context: the activities that end up LISTED (at most RADAR_GROUP_LIMIT per group) get, in ONE more query, the evaluations
 * linked to them. It is information only: the classification and the order above never look at it.
 */
export function createRadarService(
  radar: RadarRepository,
  periods: PeriodRepository,
  grading: GradingRepository,
  clock: () => Date,
) {
  return {
    async get(actor: Actor): Promise<Radar> {
      const now = clock();
      const generatedAt = now.toISOString();
      const current = await readCurrentPeriods(periods, actor.id);
      if (current.ids.length === 0) {
        return {
          generatedAt,
          period: null,
          periods: [],
          summary: zeroCounts(),
          groups: emptyGroups(),
        };
      }

      const summary = zeroCounts();
      const groups = emptyGroups();
      for (const row of await radar.listOpen(actor.id, current.ids)) {
        const status = calculateRadarStatus(row, now);
        if (status === null) continue; // the query already excludes COMPLETED; defensive, never listed
        const key = RADAR_KEYS[status];
        summary[key] += 1;
        if (groups[key].length < RADAR_GROUP_LIMIT) groups[key].push(toDashboardActivityDto(row));
      }
      // Only what is listed needs a context; an activity with no linked evaluation gets no `gradeContext` at all.
      const listed = Object.values(groups).flat();
      const linked = await grading.linkedToActivities(
        actor.id,
        listed.map((a) => a.id),
      );
      const byActivity = new Map<string, typeof linked>();
      for (const e of linked) {
        const list = byActivity.get(e.activityId!) ?? [];
        list.push(e);
        byActivity.set(e.activityId!, list);
      }
      for (const activity of listed) {
        const rows = byActivity.get(activity.id) ?? [];
        // An evaluation always has its period's scale (it cannot exist without it); all of one activity's belong to one subject.
        const scale = rows[0]?.period.gradingProfile;
        if (!scale) continue;
        const context = buildGradeContext(
          rows.map((e) => ({
            id: e.id,
            name: e.name,
            cutName: e.gradingPeriod.name,
            isCutGrade: e.isCutGrade,
            scoreMilli: e.scoreMilli,
            periodShareBp: e.periodShareBp,
            cutFinalShareBp: e.gradingPeriod.finalShareBp,
          })),
          scale,
        );
        if (context) (activity as { gradeContext?: typeof context }).gradeContext = context;
      }
      return { generatedAt, period: current.home, periods: current.contexts, summary, groups };
    },
  };
}

export type RadarService = ReturnType<typeof createRadarService>;
