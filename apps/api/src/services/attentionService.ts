import {
  ATTENTION_ALTERNATIVES_LIMIT,
  buildAttentionReasons,
  rankActivitiesForAttention,
  type Attention,
  type AttentionItem,
} from '@planner/core';
import { toDashboardActivityDto, toPeriodDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { RadarRepository } from '../repositories/radarRepository.js';
import type { Actor } from './activityService.js';

/**
 * "¿Qué hago ahora?" for the authenticated user's CURRENT period. 2 queries: the current period and the open
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
      const period = await periods.findCurrent(actor.id);
      if (!period) return { generatedAt, period: null, recommendation: null, alternatives: [] };

      const ranked = rankActivitiesForAttention(await radar.listOpen(actor.id, period.id), now);
      const items: AttentionItem[] = ranked.slice(0, 1 + ATTENTION_ALTERNATIVES_LIMIT).map((c) => ({
        activity: toDashboardActivityDto(c.activity),
        radarStatus: c.radarStatus,
        reasons: buildAttentionReasons(c.activity, now, actor.timezone),
      }));
      return {
        generatedAt,
        period: toPeriodDto(period),
        recommendation: items[0] ?? null,
        alternatives: items.slice(1),
      };
    },
  };
}

export type AttentionService = ReturnType<typeof createAttentionService>;
