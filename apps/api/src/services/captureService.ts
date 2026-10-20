import {
  interpretGrades,
  localDayBounds,
  markExistingDuplicates,
  mergeGradeCapture,
  parseCaptureProposals,
  type CaptureMode,
  type CaptureResponse,
  type CaptureResult,
  type GradeCaptureContext,
} from '@planner/core';
import { toPeriodDto } from '../mappers.js';
import type { ActivityRepository } from '../repositories/activityRepository.js';
import type { GradingRepository } from '../repositories/gradingRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';

/** A capture whose words were all about grades: nothing to do on a day, but not an empty text either. */
const gradesOnly = (characters: number): CaptureResult => ({
  status: 'OK',
  proposals: [],
  suggestions: [],
  corrections: [],
  warnings: [],
  stats: { characters, found: 0, collapsed: 0, expected: null },
});

/**
 * Interprets a text for the authenticated user into 1..N proposals: the engine of Quick Capture and the Academic Inbox
 * (one deterministic parser, `parseCaptureProposals`). It only ever sees THEIR subjects of THEIR current period and, to
 * warn about duplicates, THEIR activities of that period on the days the proposals fall on (one query, scoped by user).
 * The text is read in memory and never stored. It creates NOTHING: confirming is a separate step (F1-2c). `clock` is
 * injected so "today" is testable.
 *
 * Grades (B3): the same words are first read for scores, cut grades and the weight of new evaluations
 * (`interpretGrades`, against ALL the student's current subjects, their cuts and their evaluations). The sentences that are
 * only a grade never reach the activity engine, a weight phrase is blanked from its sentence, and a new evaluation is linked to
 * the activity that comes from the same sentence. Without grade words the result is exactly the one it always was.
 */
export function createCaptureService(
  periods: PeriodRepository,
  subjects: SubjectRepository,
  activities: ActivityRepository,
  grading: GradingRepository,
  clock: () => Date,
) {
  /** The student's current, active periods with their subjects, scales, cuts and evaluations (what the grade words refer to). */
  async function gradeContext(actor: Actor, homeId: string | null): Promise<GradeCaptureContext> {
    const current = await periods.listCurrent(actor.id);
    if (current.length === 0) return { subjects: [] };
    const periodIds = current.map((c) => c.id);
    const [rows, data] = await Promise.all([
      subjects.listInPeriods(actor.id, periodIds),
      grading.captureContext(actor.id, periodIds),
    ]);
    const byPeriod = new Map(current.map((c) => [c.id, c]));
    return {
      subjects: rows.flatMap((s) => {
        const period = byPeriod.get(s.periodId);
        if (!period) return [];
        const profile = data.profiles.find((p) => p.periodId === s.periodId) ?? null;
        return [
          {
            id: s.id,
            name: s.name,
            periodId: s.periodId,
            studyName: period.studyTrack?.name ?? null,
            // The terms of a kind of study; a period without a study cannot be graded, so its words do not matter.
            studyType: period.studyTrack?.type ?? 'UNIVERSITY',
            isHome: s.periodId === homeId,
            profile: profile && {
              minMilli: profile.minMilli,
              maxMilli: profile.maxMilli,
              passMilli: profile.passMilli,
              decimals: profile.decimals,
            },
            cuts: data.cuts
              .filter((c) => c.subjectId === s.id)
              .map((c) => ({
                id: c.id,
                name: c.name,
                position: c.position,
                finalShareBp: c.finalShareBp,
              })),
            evaluations: data.evaluations
              .filter((e) => e.subjectId === s.id)
              .map((e) => ({
                id: e.id,
                name: e.name,
                gradingPeriodId: e.gradingPeriodId,
                activityTitle: e.activityId
                  ? (data.activityTitles.get(e.activityId) ?? null)
                  : null,
                scoreMilli: e.scoreMilli,
                isCutGrade: e.isCutGrade,
              })),
          },
        ];
      }),
    };
  }

  return {
    async parse(actor: Actor, text: string, mode: CaptureMode): Promise<CaptureResponse> {
      const period = await periods.findHomeCurrent(actor.id);
      const rows = period ? await subjects.list(actor.id, period.id) : [];
      const dto = period ? toPeriodDto(period) : null;

      const interpretation = interpretGrades(text, await gradeContext(actor, period?.id ?? null));
      const hasGrades = interpretation.suggestions.length > 0;
      const activityText = hasGrades ? interpretation.maskedText : text;

      const raw =
        hasGrades && activityText.trim() === ''
          ? gradesOnly(text.trim().length)
          : parseCaptureProposals(
              activityText,
              {
                now: clock(),
                timeZone: actor.timezone,
                subjects: rows.map((s) => ({ id: s.id, name: s.name })),
                period: dto ? { startDate: dto.startDate, endDate: dto.endDate } : null,
              },
              mode,
            );
      // The merge links each new evaluation to the activity of its own sentence, or drops an activity that gave no date.
      const merged = hasGrades
        ? mergeGradeCapture(raw, interpretation, new Set(rows.map((s) => s.id)))
        : { capture: raw, grades: { suggestions: [] } };
      // With grades the leftover text can legitimately say nothing about activities: that is not "no activities".
      const capture: CaptureResult =
        hasGrades && merged.capture.status === 'OK'
          ? {
              ...merged.capture,
              warnings: merged.capture.warnings.filter((w) => w.code !== 'NO_ACTIVITIES'),
            }
          : merged.capture;

      const days = capture.proposals.flatMap((p) => (p.date.value ? [p.date.value] : [])).sort();
      if (!period || days.length === 0) return { capture, period: dto, grades: merged.grades };

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
        grades: merged.grades,
      };
    },
  };
}

export type CaptureService = ReturnType<typeof createCaptureService>;
