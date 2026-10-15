import {
  ATTENTION_ALTERNATIVES_LIMIT,
  buildAttentionReasons,
  nearestDeadlines,
  rankActivitiesForAttention,
  type Attention,
  type AttentionItem,
} from '@planner/core';
import { toDashboardActivityDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { RadarRepository } from '../repositories/radarRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';

/**
 * "¿Qué hago ahora?" over ALL the authenticated user's current, active periods (no study has priority). 2 queries: the
 * current periods and the open
 * activities (the same read-only query the Radar uses). The ranking is the core engine and is ALWAYS applied
 * here: the database order is never trusted. Nothing is stored; `clock` is injected so every case is testable.
 */
export function createAttentionService(
  radar: RadarRepository,
  periods: PeriodRepository,
  clock: () => Date,
) {
  return {
    async get(actor: Actor): Promise<Attention> {
      const now = clock();
      const generatedAt = now.toISOString();
      const current = await readCurrentPeriods(periods, actor.id);
      if (current.ids.length === 0) {
        return {
          generatedAt,
          period: null,
          periods: [],
          recommendation: null,
          alternatives: [],
          upcoming: [],
        };
      }

      const open = await radar.listOpen(actor.id, current.ids);
      const toItem = (c: {
        activity: (typeof open)[number];
        radarStatus: AttentionItem['radarStatus'];
      }) => ({
        activity: toDashboardActivityDto(c.activity),
        radarStatus: c.radarStatus,
        reasons: buildAttentionReasons(c.activity, now, actor.timezone),
      });
      const ranked = rankActivitiesForAttention(open, now);
      const items: AttentionItem[] = ranked.slice(0, 1 + ATTENTION_ALTERNATIVES_LIMIT).map(toItem);
      return {
        generatedAt,
        period: current.home,
        periods: current.contexts,
        recommendation: items[0] ?? null,
        alternatives: items.slice(1),
        upcoming: nearestDeadlines(open, now).map(toItem),
      };
    },
  };
}

export type AttentionService = ReturnType<typeof createAttentionService>;
