import {
  SCHEDULE_IMPORT_MESSAGES,
  SCHEDULE_IMPORT_TIMEOUT_MS,
  findDuplicateClass,
  parseScheduleDocument,
  type ScheduleImportProposal,
  type ScheduleImportResult,
} from '@planner/core';
import { AppError } from '../errors/AppError.js';
import { toPeriodDto } from '../mappers.js';
import type { PeriodRepository } from '../repositories/periodRepository.js';
import type { ScheduleRepository } from '../repositories/scheduleRepository.js';
import type { SubjectRepository } from '../repositories/subjectRepository.js';
import { windowOf } from './scheduleOccurrences.js';
import type { Actor } from './activityService.js';
import type { ScheduleService } from './scheduleService.js';
import { validateFile, type UploadedFile } from '../scheduleImport/fileValidation.js';
import { extractContent, type ExtractionDeps } from '../scheduleImport/pipeline.js';

export interface ImportLogEvent {
  event: 'schedule_import';
  type: 'IMAGE' | 'PDF' | 'REJECTED';
  bytes: number;
  ms: number;
  result: 'OK' | 'NOTHING_FOUND' | 'ERROR';
  method?: string;
  proposals?: number;
  code?: string;
}

/**
 * Interprets a schedule document (image or PDF) for the authenticated user. Flow:
 *   validateFile -> extractContent (PDF text, OCR as fallback) -> parseScheduleDocument (pure, in core)
 *   -> subjects of THEIR current period -> duplicates and conflicts against THEIR agenda.
 * It creates nothing and stores nothing: the file lives in memory for the request only and is never written to
 * disk. Each confirmed proposal is created later with the normal POST /api/schedule.
 * Logs carry type, size, duration and outcome: never the text read, the image or any academic data.
 */
export function createScheduleImportService(opts: {
  periods: PeriodRepository;
  subjects: SubjectRepository;
  schedule: ScheduleRepository;
  scheduleService: ScheduleService;
  extraction: ExtractionDeps;
  timeoutMs?: number;
  log?: (event: ImportLogEvent) => void;
}) {
  const { periods, subjects, schedule, scheduleService, extraction } = opts;
  const timeoutMs = opts.timeoutMs ?? SCHEDULE_IMPORT_TIMEOUT_MS;
  const log = opts.log ?? ((e) => console.info(JSON.stringify(e)));
  /** One import per user at a time: OCR is heavy and a second upload would only queue behind it. */
  const running = new Set<string>();

  async function withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Stop the engine as well, or it would keep working for a request nobody waits for.
        void extraction.ocr.abort().catch(() => undefined);
        reject(new AppError(504, 'IMPORT_TIMEOUT', SCHEDULE_IMPORT_MESSAGES.TIMEOUT));
      }, timeoutMs);
    });
    try {
      return await Promise.race([work, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async parse(actor: Actor, upload: UploadedFile): Promise<ScheduleImportResult> {
      const started = Date.now();
      const bytes = upload.buffer.length;
      const finish = (e: Omit<ImportLogEvent, 'event' | 'bytes' | 'ms'>) =>
        log({ event: 'schedule_import', bytes, ms: Date.now() - started, ...e });

      if (running.has(actor.id)) {
        throw new AppError(
          429,
          'IMPORT_IN_PROGRESS',
          'Ya estamos procesando un horario tuyo. Espera a que termine.',
        );
      }
      running.add(actor.id);
      let kind: ImportLogEvent['type'] = 'REJECTED';
      try {
        const file = validateFile(upload);
        kind = file.kind === 'pdf' ? 'PDF' : 'IMAGE';

        const period = await periods.findCurrent(actor.id);
        if (!period) {
          throw new AppError(
            400,
            'NO_CURRENT_PERIOD',
            'Configura tu periodo académico antes de importar tu horario.',
          );
        }
        const periodDto = toPeriodDto(period);
        const subjectRows = await subjects.list(actor.id, period.id);

        const extracted = await withTimeout(extractContent(file, extraction));
        const parsed = parseScheduleDocument(extracted.doc, {
          subjects: subjectRows.map((s) => ({ id: s.id, name: s.name })),
          period: { startDate: periodDto.startDate, endDate: periodDto.endDate },
        });

        const proposals = await annotate(actor, period.id, periodDto, parsed.proposals);
        const result: ScheduleImportResult = {
          source: {
            type: extracted.type,
            pages: extracted.doc.pages.length,
            method: extracted.method,
          },
          layout: parsed.layout,
          status: proposals.length > 0 ? 'OK' : 'NOTHING_FOUND',
          proposals,
          warnings: parsed.warnings,
          period: {
            id: periodDto.id,
            name: periodDto.name,
            startDate: periodDto.startDate,
            endDate: periodDto.endDate,
          },
        };
        finish({
          type: extracted.type,
          result: result.status,
          method: extracted.method,
          proposals: proposals.length,
        });
        return result;
      } catch (err) {
        finish({ type: kind, result: 'ERROR', code: err instanceof AppError ? err.code : 'ERROR' });
        throw err;
      } finally {
        running.delete(actor.id);
      }
    },
  };

  /**
   * Duplicates (same class already in the agenda) and conflicts (an overlapping DIFFERENT class). Conflicts come
   * from the Schedule service itself in dry-run mode, so the rule is the one used everywhere else.
   */
  async function annotate(
    actor: Actor,
    periodId: string,
    period: { startDate: string; endDate: string },
    proposals: ReturnType<typeof parseScheduleDocument>['proposals'],
  ): Promise<ScheduleImportProposal[]> {
    if (proposals.length === 0) return [];
    const rows = await schedule.candidates(actor.id, {
      ...windowOf({ from: period.startDate, to: period.endDate }, actor.timezone),
      types: ['CLASS'],
      periodId,
    });
    const existing = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      subjectId: r.subjectId,
      startAt: r.startAt,
      endAt: r.endAt,
      recurring: r.recurrenceType === 'WEEKLY' && r.recurrenceUntil !== null,
    }));

    const out: ScheduleImportProposal[] = [];
    for (const p of proposals) {
      const duplicate = findDuplicateClass(p, existing, actor.timezone);
      let conflicts: ScheduleImportProposal['conflicts'] = [];
      const complete =
        p.subjectId && p.date && p.startTime && p.endTime && p.endTime > p.startTime && p.weekday;
      if (complete) {
        try {
          const { warnings } = await scheduleService.create(
            actor,
            {
              type: 'CLASS',
              subjectId: p.subjectId,
              title: p.title,
              date: p.date!,
              startTime: p.startTime!,
              endTime: p.endTime!,
              recurrence: p.recurrence,
            },
            { dryRun: true },
          );
          conflicts = warnings
            .filter((w) => w.with.blockId !== duplicate?.id)
            .map((w) => ({
              blockId: w.with.blockId,
              title: w.with.title,
              startAt: w.with.startAt,
              endAt: w.with.endAt,
              occurrences: w.with.occurrences,
            }));
        } catch (err) {
          // A rule of the Schedule service says no (e.g. a date outside the period): the student will see
          // it when confirming. It must not break the whole preview.
          if (!(err instanceof AppError)) throw err;
        }
      }
      out.push({
        ...p,
        duplicateOf: duplicate ? { id: duplicate.id, title: duplicate.title } : null,
        warnings: duplicate
          ? [
              ...p.warnings,
              { code: 'POSSIBLE_DUPLICATE', message: SCHEDULE_IMPORT_MESSAGES.POSSIBLE_DUPLICATE },
            ]
          : p.warnings,
        conflicts,
      });
    }
    return out;
  }
}

export type ScheduleImportService = ReturnType<typeof createScheduleImportService>;
