import {
  localDayBounds,
  markExistingDuplicates,
  parseCaptureProposals,
  type CaptureMode,
  type CaptureResponse,
} from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import type { ActivityRepository } from '../repositories/activityRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';

/**
 * Interprets a text for the authenticated user into 1..N proposals: the engine of Quick Capture and the Academic Inbox
 * (one deterministic parser, `parseCaptureProposals`). It only ever sees THEIR subjects of THEIR current period and, to
 * warn about duplicates, THEIR activities of that period on the days the proposals fall on (one query, scoped by user).
 * The text is read in memory and never stored. It creates NOTHING: confirming is a separate step (F1-2c). `clock` is
 * injected so "today" is testable.
 */
export function createCaptureService(
  periods: PeriodRepository,
  subjects: SubjectRepository,
  activities: ActivityRepository,
  clock: () => Date,
) {
  return {
    async parse(actor: Actor, text: string, mode: CaptureMode): Promise<CaptureResponse> {
      const period = await periods.findCurrent(actor.id);
      const rows = period ? await subjects.list(actor.id, period.id) : [];
      const dto = period ? toPeriodDto(period) : null;
      const capture = parseCaptureProposals(
        text,
        {
          now: clock(),
          timeZone: actor.timezone,
          subjects: rows.map((s) => ({ id: s.id, name: s.name })),
          period: dto ? { startDate: dto.startDate, endDate: dto.endDate } : null,
        },
        mode,
      );

      const days = capture.proposals.flatMap((p) => (p.date.value ? [p.date.value] : [])).sort();
      if (!period || days.length === 0) return { capture, period: dto };

      const existing = await activities.list(actor.id, {
        periodId: period.id,
        dueFrom: localDayBounds(days[0]!, actor.timezone).start,
        dueTo: localDayBounds(days.at(-1)!, actor.timezone).end,
      });
      return {
        capture: {
          ...capture,
          proposals: markExistingDuplicates(
            capture.proposals,
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

export type CaptureService = ReturnType<typeof createCaptureService>;
