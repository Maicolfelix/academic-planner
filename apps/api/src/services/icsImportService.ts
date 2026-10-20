import {
  ICS_IMPORT_MESSAGES,
  dueFromLocal,
  findDuplicateBlock,
  proposeIcsEvents,
  type ExistingClass,
  type IcsParseResponse,
  type IcsProposal,
  type Weekday,
} from '@planner/core';
import { parseIcsFile, IcsFileError } from '../ics/parseIcs.js';
import { AppError, validationError } from '../errors/AppError.js';
import { toDateOnly } from '../mappers.js';
import type { ActivityRepository } from '../repositories/activityRepository.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { ScheduleRepository } from '../repositories/scheduleRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import type { Actor } from './activityService.js';
import { readCurrentPeriods } from './currentPeriods.js';
import { windowOf } from './scheduleOccurrences.js';

/**
 * Interprets a .ics file for the authenticated user into PROPOSALS. It creates nothing and stores nothing: the file lives in
 * memory for this request. It sees only THEIR subjects of THEIR current, active periods (every study, so a calendar may mix
 * studies), and — to flag copies — THEIR activities and weekly classes on the days involved (three reads, whatever the number
 * of events). The classification is `proposeIcsEvents` from core; the parsing is the adapter in `../ics`.
 */
export function createIcsImportService(deps: {
  periods: PeriodRepository;
  subjects: SubjectRepository;
  activities: ActivityRepository;
  schedule: ScheduleRepository;
}) {
  const { periods, subjects, activities, schedule } = deps;

  return {
    async parse(
      actor: Actor,
      file: { buffer: Buffer; originalname: string },
    ): Promise<IcsParseResponse> {
      let events;
      try {
        events = parseIcsFile(file.buffer, actor.timezone);
      } catch (err) {
        if (err instanceof IcsFileError) {
          if (err.code === 'TOO_LARGE')
            throw new AppError(413, 'FILE_TOO_LARGE', ICS_IMPORT_MESSAGES.TOO_LARGE);
          throw validationError({ file: [err.message] });
        }
        throw err;
      }

      const current = await readCurrentPeriods(periods, actor.id);
      const rows =
        current.ids.length > 0 ? await subjects.listInPeriods(actor.id, current.ids) : [];
      const { proposals, summary } = proposeIcsEvents(events, {
        subjects: rows.map((s) => ({ id: s.id, name: s.name, periodId: s.periodId })),
      });

      // Copies of what the student already has (never a block: a possible duplicate is flagged and unticked, the student decides).
      const studyOf = new Map(current.rows.map((r) => [r.id, r.studyTrack?.name ?? null]));
      const periodEnd = new Map(current.rows.map((r) => [r.id, toDateOnly(r.endDate)]));
      const flagged = new Set<string>();
      const subjectPeriod = new Map(rows.map((s) => [s.id, s.periodId]));
      const subjectIdOf = (p: IcsProposal) => (p.subject.kind === 'EXISTING' ? p.subject.id : null);

      const acts = proposals.filter(
        (p) =>
          p.kindProposal === 'ACTIVITY' &&
          p.date !== null &&
          p.subject.kind !== 'AMBIGUOUS' &&
          p.title !== '',
      );
      if (acts.length > 0) {
        const dues = acts.map(
          (p) => dueFromLocal({ date: p.date!, time: p.startTime }, actor.timezone).dueAt,
        );
        const present = await activities.list(actor.id, {
          dueFrom: new Date(Math.min(...dues.map((d) => d.getTime()))),
          dueTo: new Date(Math.max(...dues.map((d) => d.getTime()))),
        });
        acts.forEach((p, i) => {
          const copy = present.some(
            (a) =>
              a.subjectId === subjectIdOf(p) &&
              a.type === p.type &&
              a.title.trim().toLowerCase() === p.title.trim().toLowerCase() &&
              a.dueAt.getTime() === dues[i]!.getTime(),
          );
          if (copy) flagged.add(p.clientId);
        });
      }

      const blocks = proposals.filter(
        (p) =>
          p.kindProposal === 'SCHEDULE_BLOCK' &&
          p.repeats === 'WEEKLY' &&
          p.subject.kind === 'EXISTING' &&
          p.endTime &&
          p.date,
      );
      if (blocks.length > 0 && current.rows.length > 0) {
        const days = {
          from: current.rows.map((r) => toDateOnly(r.startDate)).sort()[0]!,
          to: current.rows
            .map((r) => toDateOnly(r.endDate))
            .sort()
            .at(-1)!,
        };
        const inAgenda: ExistingClass[] = (
          await schedule.candidates(actor.id, {
            ...windowOf(days, actor.timezone),
            types: ['CLASS', 'STUDY'],
            periodIds: current.ids,
          })
        ).map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          subjectId: r.subjectId,
          startAt: r.startAt,
          endAt: r.endAt,
          recurring: r.recurrenceType === 'WEEKLY' && r.recurrenceUntil !== null,
          until: r.recurrenceUntil ? toDateOnly(r.recurrenceUntil) : null,
        }));
        for (const p of blocks) {
          const sid = subjectIdOf(p)!;
          const end = periodEnd.get(subjectPeriod.get(sid)!);
          const weekday = Number(new Date(`${p.date}T12:00:00Z`).getUTCDay() || 7) as Weekday;
          if (
            findDuplicateBlock(
              {
                type: 'CLASS',
                subjectId: sid,
                weekday,
                startTime: p.startTime!,
                endTime: p.endTime!,
                range: { from: p.date!, until: p.until ?? end ?? p.date! },
              },
              inAgenda,
              actor.timezone,
            )
          )
            flagged.add(p.clientId);
        }
      }

      const marked = proposals.map((p) =>
        flagged.has(p.clientId)
          ? {
              ...p,
              selected: false,
              duplicateOf: p.duplicateOf ?? 'AGENDA',
              warnings: [
                ...p.warnings,
                { code: 'DUPLICATE_AGENDA' as const, message: 'Parece que ya está en tu agenda.' },
              ],
            }
          : p,
      );

      return {
        fileName: file.originalname.slice(0, 120),
        proposals: marked,
        summary,
        subjects: rows.map((s) => ({
          id: s.id,
          name: s.name,
          periodId: s.periodId,
          studyName: studyOf.get(s.periodId) ?? null,
        })),
      };
    },
  };
}

export type IcsImportService = ReturnType<typeof createIcsImportService>;
