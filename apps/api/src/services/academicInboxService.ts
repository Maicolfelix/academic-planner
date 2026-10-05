import {
  localDayBounds,
  markPossibleDuplicates,
  parseAcademicInbox,
  type AcademicInboxResponse,
} from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import type { ActivityRepository } from '../repositories/activityRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';

/**
 * Interprets a pasted message for the authenticated user. It only ever sees THEIR subjects of THEIR current period
 * and, to warn about duplicates, THEIR activities of that period on the days the proposals fall on (one query,
 * scoped by user). The text is interpreted in memory with the deterministic parser of core and is never stored or
 * sent anywhere. It creates nothing: each confirmed proposal goes through the normal POST /api/activities.
 * `clock` is injected so "today" is testable.
 */
export function createAcademicInboxService(
  periods: PeriodRepository,
  subjects: SubjectRepository,
  activities: ActivityRepository,
  clock: () => Date,
) {
  return {
    async parse(actor: Actor, text: string): Promise<AcademicInboxResponse> {
      const period = await periods.findCurrent(actor.id);
      const rows = period ? await subjects.list(actor.id, period.id) : [];
      const dto = period ? toPeriodDto(period) : null;
      const inbox = parseAcademicInbox(text, {
        now: clock(),
        timeZone: actor.timezone,
        subjects: rows.map((s) => ({ id: s.id, name: s.name })),
        period: dto ? { startDate: dto.startDate, endDate: dto.endDate } : null,
      });

      const days = inbox.proposals.flatMap((p) => (p.dueDate ? [p.dueDate] : [])).sort();
      if (!period || days.length === 0) return { inbox, period: dto };

      const existing = await activities.list(actor.id, {
        periodId: period.id,
        dueFrom: localDayBounds(days[0]!, actor.timezone).start,
        dueTo: localDayBounds(days.at(-1)!, actor.timezone).end,
      });
      return {
        inbox: {
          ...inbox,
          proposals: markPossibleDuplicates(
            inbox.proposals,
            existing.map((a) => ({
              id: a.id,
              title: a.title,
              type: a.type,
              subjectId: a.subjectId,
              dueAt: a.dueAt,
            })),
            actor.timezone,
          ),
        },
        period: dto,
      };
    },
  };
}

export type AcademicInboxService = ReturnType<typeof createAcademicInboxService>;
