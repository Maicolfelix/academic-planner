import { parseQuickCapture, type QuickCaptureResponse } from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';

/**
 * Interprets a short phrase for the authenticated user. It only ever sees THEIR subjects of THEIR current
 * period (the repository calls are scoped by user), runs the deterministic parser of core and returns the
 * proposal. It creates nothing: confirming goes through the normal POST /api/activities. The text is never
 * stored or sent anywhere. `clock` is injected so "today" is testable.
 */
export function createQuickCaptureService(
  periods: PeriodRepository,
  subjects: SubjectRepository,
  clock: () => Date,
) {
  return {
    async parse(actor: Actor, text: string): Promise<QuickCaptureResponse> {
      const period = await periods.findCurrent(actor.id);
      const rows = period ? await subjects.list(actor.id, period.id) : [];
      const dto = period ? toPeriodDto(period) : null;
      const capture = parseQuickCapture(text, {
        now: clock(),
        timeZone: actor.timezone,
        subjects: rows.map((s) => ({ id: s.id, name: s.name })),
        period: dto ? { startDate: dto.startDate, endDate: dto.endDate } : null,
      });
      return { capture, period: dto };
    },
  };
}

export type QuickCaptureService = ReturnType<typeof createQuickCaptureService>;
