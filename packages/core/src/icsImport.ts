import { z } from 'zod';
import { dateOnlySchema, type DateOnly } from './academic.js';
import {
  ACTIVITY_DESCRIPTION_MAX,
  ACTIVITY_TITLE_MAX,
  ACTIVITY_TYPES,
  dueTimeSchema,
  type ActivityType,
} from './activity.js';
import { addDays, weekdayOf, type Weekday } from './calendar.js';
import { buildSubjectEntries, findTypes, matchSubject, tokenize } from './captureShared.js';
import { SCHEDULE_TITLE_MAX } from './schedule.js';

/**
 * ICS IMPORT (A2). A calendar file is READ, INTERPRETED and PROPOSED; nothing is created until the student reviews it and
 * confirms. This module is the pure half: what an event of a .ics means for Academic Planner, decided by fixed rules.
 *
 * Supported subset (exactly this, nothing implied):
 *  - VEVENT with SUMMARY, DESCRIPTION, LOCATION, DTSTART, DTEND, UID, RRULE and EXDATE;
 *  - a timed or all-day single event → an ACTIVITY (a date, and a time when it has one);
 *  - a WEEKLY repetition (INTERVAL 1, BYDAY, UNTIL or COUNT) with a time and an end time → weekly SCHEDULE BLOCKS (one per day);
 *  - times with a TZID, in UTC or floating (floating = the student's own timezone).
 * Anything else (monthly/yearly/other rules, RDATE, a modified instance, a cancelled event, an invalid date, a repetition that
 * crosses midnight) is never guessed: it is UNSUPPORTED or goes to review, with the reason. EXDATE is never dropped silently.
 * The adapter (`apps/api/src/ics`) turns the file into `IcsRawEvent`s already in the STUDENT's local time.
 */

export const ICS_IMPORT_MAX_BYTES = 1_048_576;
export const ICS_IMPORT_MAX_EVENTS = 500;
/** More occurrences than a year of weeks (a COUNT this big is refused, never expanded). */
export const ICS_MAX_COUNT = 260;
export const ICS_IMPORT_MAX_ITEMS = 500;

export const ICS_IMPORT_MESSAGES = {
  EMPTY: 'El archivo está vacío.',
  TOO_LARGE: 'El archivo supera 1 MB. Divide el calendario e inténtalo de nuevo.',
  NOT_CALENDAR: 'Este archivo no parece un calendario .ics.',
  TOO_MANY: 'El calendario tiene más de 500 eventos. Exporta un rango más corto.',
  NO_EVENTS: 'No encontré eventos en el calendario.',
  INVALID_TEXT: 'El archivo tiene caracteres no válidos.',
  NO_FILE: 'Selecciona un archivo .ics.',
} as const;

// ── What the adapter reads from the file (already in the student's local time) ───────────────────────────────────────────

export type IcsMoment =
  { allDay: true; date: DateOnly } | { allDay: false; date: DateOnly; time: string };

export interface IcsRule {
  freq: string;
  interval: number;
  /** Raw BYDAY codes ("TU", "1MO"). */
  byday: string[];
  /** Local last day, when the rule has UNTIL. */
  until: DateOnly | null;
  count: number | null;
  /** Any other part of the rule (BYMONTH, BYSETPOS, BYMONTHDAY…): not representable. */
  other: boolean;
}

export interface IcsRawEvent {
  /** Position in the file (stable ids). */
  index: number;
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  status: string | null;
  hasRecurrenceId: boolean;
  hasRdate: boolean;
  /** null: DTSTART missing or not a valid date. */
  start: IcsMoment | null;
  end: IcsMoment | null;
  /** 'INVALID': an RRULE the adapter could not read. */
  rrule: IcsRule | 'INVALID' | null;
  exdateCount: number;
}

// ── Proposals ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ICS_WARNINGS = [
  'DUPLICATE_UID',
  'EXCEPTIONS',
  'MULTI_DAY',
  'TITLE_TRUNCATED',
  'DESCRIPTION_TRUNCATED',
  'NO_END_TIME',
  'REPEATS_TO_PERIOD_END',
  'DUPLICATE_AGENDA',
] as const;

export const icsSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }),
  z.object({ kind: z.literal('EXISTING'), id: z.uuid(), name: z.string(), periodId: z.uuid() }),
  z.object({
    kind: z.literal('AMBIGUOUS'),
    candidates: z.array(z.object({ id: z.uuid(), name: z.string(), periodId: z.uuid() })),
  }),
]);
export type IcsSubject = z.infer<typeof icsSubjectSchema>;

export const icsProposalSchema = z.object({
  clientId: z.string(),
  sourceUid: z.string().nullable(),
  sourceTitle: z.string(),
  kindProposal: z.enum(['ACTIVITY', 'SCHEDULE_BLOCK', 'UNSUPPORTED']),
  /** READY: nothing to ask; NEEDS_REVIEW: the student must settle `blocking`. */
  status: z.enum(['READY', 'NEEDS_REVIEW']),
  /** Why it cannot be imported (UNSUPPORTED only). */
  reason: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(ACTIVITY_TYPES),
  subject: icsSubjectSchema,
  /** Local day of the event (the first occurrence of a weekly block). */
  date: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  allDay: z.boolean(),
  repeats: z.enum(['NONE', 'WEEKLY']),
  /** Last day of a weekly repetition when the file says it (UNTIL / COUNT); null = until the end of the period. */
  until: z.string().nullable(),
  /** How many calendar exceptions (EXDATE) the event has: Academic Planner cannot store them. */
  exceptions: z.number().int().nonnegative(),
  warnings: z.array(z.object({ code: z.enum(ICS_WARNINGS), message: z.string() })),
  /** What the student still has to settle. */
  blocking: z.array(z.enum(['title', 'subject', 'endTime', 'exceptions'])),
  /** The clientId of the earlier event of the file with the same UID, or the text of the Agenda item it seems to copy. */
  duplicateOf: z.string().nullable(),
  selected: z.boolean(),
});
export type IcsProposal = z.infer<typeof icsProposalSchema>;

export const icsSubjectChoiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  periodId: z.uuid(),
  /** The study the subject belongs to (to tell two equal names apart), or null. */
  studyName: z.string().nullable(),
});
export type IcsSubjectChoice = z.infer<typeof icsSubjectChoiceSchema>;

export const icsParseResponseSchema = z.object({
  fileName: z.string(),
  proposals: z.array(icsProposalSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    activities: z.number().int().nonnegative(),
    scheduleBlocks: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
  }),
  /** The student's current subjects (every current study), to choose from in the review. */
  subjects: z.array(icsSubjectChoiceSchema),
});
export type IcsParseResponse = z.infer<typeof icsParseResponseSchema>;

// ── The rules ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const WEEKDAY_CODE: Record<string, Weekday> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export interface IcsContext {
  subjects: readonly { id: string; name: string; periodId: string }[];
}

/** The description plus the place, when the file has one. */
const describe = (e: IcsRawEvent): string | null => {
  const text = [e.description, e.location ? `Lugar: ${e.location}` : null]
    .filter(Boolean)
    .join('\n');
  return text === '' ? null : clip(text, ACTIVITY_DESCRIPTION_MAX);
};
function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** Occurrence dates of a weekly rule per weekday: first date, and last date when the rule ends (UNTIL / COUNT). */
function weeklyDates(
  start: DateOnly,
  weekdays: readonly Weekday[],
  until: DateOnly | null,
  count: number | null,
): { weekday: Weekday; first: DateOnly; last: DateOnly | null }[] {
  const wanted = new Set(weekdays);
  const first = new Map<Weekday, DateOnly>();
  const last = new Map<Weekday, DateOnly>();
  let produced = 0;
  // A year of weeks is the most a COUNT may ask for (ICS_MAX_COUNT occurrences at most, one per day at most).
  for (let offset = 0; offset < 366 * 6; offset++) {
    const day = addDays(start, offset);
    if (until && day > until) break;
    const weekday = weekdayOf(day);
    if (!wanted.has(weekday)) continue;
    if (count !== null && produced >= count) break;
    produced++;
    if (!first.has(weekday)) first.set(weekday, day);
    last.set(weekday, day);
    // Without UNTIL or COUNT only the first date of each weekday is needed.
    if (count === null && until === null && first.size === wanted.size) break;
  }
  const bounded = count !== null || until !== null;
  return [...first.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, firstDate]) => ({
      weekday,
      first: firstDate,
      last: bounded ? last.get(weekday)! : null,
    }));
}

export function proposeIcsEvents(
  events: readonly IcsRawEvent[],
  context: IcsContext,
): { proposals: IcsProposal[]; summary: IcsParseResponse['summary'] } {
  const entries = buildSubjectEntries(context.subjects);
  const byId = new Map(context.subjects.map((s) => [s.id, s]));
  const proposals: IcsProposal[] = [];
  const seenUid = new Map<string, string>(); // uid -> clientId of the first event with it

  for (const e of events) {
    const clientId = `e${e.index}`;
    const base = {
      sourceUid: e.uid,
      sourceTitle: e.summary,
      description: describe(e),
      subject: { kind: 'NONE' } as IcsSubject,
      date: null as string | null,
      startTime: null as string | null,
      endTime: null as string | null,
      allDay: false,
      repeats: 'NONE' as 'NONE' | 'WEEKLY',
      until: null as string | null,
      exceptions: e.exdateCount,
      warnings: [] as IcsProposal['warnings'],
      blocking: [] as IcsProposal['blocking'],
      duplicateOf: null as string | null,
      type: 'TASK' as ActivityType,
    };
    const unsupported = (reason: string) =>
      proposals.push({
        ...base,
        clientId,
        kindProposal: 'UNSUPPORTED',
        status: 'NEEDS_REVIEW',
        reason,
        title: e.summary,
        selected: false,
      });

    if (e.start === null) {
      unsupported('La fecha de inicio no es válida.');
      continue;
    }
    if (e.status?.toUpperCase() === 'CANCELLED') {
      unsupported('El evento está cancelado en el calendario.');
      continue;
    }
    if (e.hasRecurrenceId) {
      unsupported(
        'Es una versión modificada de un evento que se repite: todavía no se puede importar.',
      );
      continue;
    }
    if (e.hasRdate) {
      unsupported('Tiene fechas de repetición sueltas (RDATE): todavía no se puede importar.');
      continue;
    }

    // The subject: only a deterministic match of the SUMMARY; an unknown name never picks another subject.
    const summary = e.summary.trim();
    const tokens = tokenize(summary);
    const hit = matchSubject(tokens, entries);
    let subject: IcsSubject = { kind: 'NONE' };
    if (hit.kind === 'match') {
      const s = byId.get(hit.subject.id)!;
      subject = { kind: 'EXISTING', id: s.id, name: s.name, periodId: s.periodId };
    } else if (hit.kind === 'ambiguous' && !hit.weak) {
      subject = {
        kind: 'AMBIGUOUS',
        candidates: hit.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          periodId: byId.get(c.id)!.periodId,
        })),
      };
    }
    // The activity type from the words of the title ("Parcial", "Quiz"…), else a plain task.
    const typeHit = findTypes(tokenize(summary))[0];
    const type: ActivityType = typeHit ? (typeHit.type as ActivityType) : 'TASK';

    const warnings: IcsProposal['warnings'] = [];
    const blocking: IcsProposal['blocking'] = [];
    let title = summary;
    if (title === '') blocking.push('title');
    const maxTitle = Math.min(ACTIVITY_TITLE_MAX, SCHEDULE_TITLE_MAX);
    if (title.length > maxTitle) {
      title = clip(title, maxTitle);
      warnings.push({
        code: 'TITLE_TRUNCATED',
        message: `El título se acortó a ${maxTitle} caracteres.`,
      });
    }
    if (e.description !== null && e.description.length > ACTIVITY_DESCRIPTION_MAX)
      warnings.push({ code: 'DESCRIPTION_TRUNCATED', message: 'La descripción se acortó.' });
    if (subject.kind === 'AMBIGUOUS') blocking.push('subject');

    const common = { ...base, clientId, title, type, subject, warnings, blocking, reason: null };
    const duplicateUid = e.uid !== null && seenUid.has(e.uid) ? seenUid.get(e.uid)! : null;
    if (e.uid !== null && !seenUid.has(e.uid)) seenUid.set(e.uid, clientId);
    const withDuplicate = <
      T extends {
        warnings: IcsProposal['warnings'];
        selected: boolean;
        duplicateOf: string | null;
      },
    >(
      p: T,
    ): T => {
      if (duplicateUid === null) return p;
      return {
        ...p,
        duplicateOf: duplicateUid,
        selected: false,
        warnings: [
          ...p.warnings,
          {
            code: 'DUPLICATE_UID' as const,
            message: 'Otro evento del archivo tiene el mismo identificador.',
          },
        ],
      };
    };
    const statusOf = (b: IcsProposal['blocking']) =>
      b.length === 0 ? ('READY' as const) : ('NEEDS_REVIEW' as const);

    // ── A repetition ──
    if (e.rrule !== null) {
      const r = e.rrule;
      if (r === 'INVALID') {
        unsupported('La regla de repetición no se pudo leer.');
        continue;
      }
      if (r.freq !== 'WEEKLY') {
        unsupported('Se repite de una forma que todavía no se puede importar (solo semanal).');
        continue;
      }
      if (r.interval !== 1 || r.other) {
        unsupported('La repetición tiene condiciones que todavía no se pueden importar.');
        continue;
      }
      if (r.count !== null && (r.count < 1 || r.count > ICS_MAX_COUNT)) {
        unsupported(`La repetición pide demasiadas fechas (más de ${ICS_MAX_COUNT}).`);
        continue;
      }
      if (e.start.allDay) {
        unsupported('Es un evento de día completo que se repite: todavía no se puede importar.');
        continue;
      }
      const codes = r.byday.length > 0 ? r.byday : [''];
      const weekdays: Weekday[] = [];
      let badDay = false;
      for (const code of codes) {
        if (code === '') weekdays.push(weekdayOf(e.start.date));
        else if (WEEKDAY_CODE[code]) weekdays.push(WEEKDAY_CODE[code]!);
        else badDay = true; // "1MO", "-1FR": the n-th weekday of a month
      }
      if (badDay) {
        unsupported('La repetición usa días que todavía no se pueden importar.');
        continue;
      }
      const endTime = e.end && !e.end.allDay ? e.end : null;
      if (
        e.end &&
        (e.end.allDay || e.end.date !== e.start.date || (endTime && endTime.time <= e.start.time))
      ) {
        unsupported(
          'Cada clase termina otro día o no termina después de empezar: todavía no se puede importar.',
        );
        continue;
      }
      const blockBlocking = [...blocking];
      if (!endTime) {
        blockBlocking.push('endTime');
        warnings.push({
          code: 'NO_END_TIME',
          message: 'El evento no trae hora de fin: indícala tú.',
        });
      }
      if (subject.kind !== 'EXISTING' && !blockBlocking.includes('subject'))
        blockBlocking.push('subject');
      if (e.exdateCount > 0) {
        blockBlocking.push('exceptions');
        warnings.push({
          code: 'EXCEPTIONS',
          message:
            'Este evento tiene excepciones de calendario que Academic Planner todavía no puede guardar.',
        });
      }
      const occurrences = weeklyDates(e.start.date, [...new Set(weekdays)], r.until, r.count);
      if (occurrences.length === 0) {
        unsupported('La repetición no tiene ninguna fecha dentro de su rango.');
        continue;
      }
      for (const o of occurrences) {
        const blockWarnings = [...warnings];
        if (o.last === null)
          blockWarnings.push({
            code: 'REPEATS_TO_PERIOD_END',
            message: 'Se repite cada semana hasta el fin del periodo.',
          });
        proposals.push(
          withDuplicate({
            ...common,
            clientId: occurrences.length > 1 ? `${clientId}:${o.weekday}` : clientId,
            kindProposal: 'SCHEDULE_BLOCK' as const,
            status: statusOf(blockBlocking),
            warnings: blockWarnings,
            blocking: blockBlocking,
            date: o.first,
            startTime: e.start.time,
            endTime: endTime ? endTime.time : null,
            repeats: 'WEEKLY' as const,
            until: o.last,
            selected: blockBlocking.length === 0,
          }),
        );
      }
      continue;
    }

    // ── A single event: an activity ──
    const multiDay =
      e.end &&
      e.end.date > e.start.date &&
      !(e.start.allDay && e.end.date === addDays(e.start.date, 1));
    if (multiDay)
      warnings.push({ code: 'MULTI_DAY', message: 'Dura varios días: se usa la fecha de inicio.' });
    const allDay = e.start.allDay;
    proposals.push(
      withDuplicate({
        ...common,
        kindProposal: 'ACTIVITY' as const,
        status: statusOf(blocking),
        warnings,
        date: e.start.date,
        startTime: e.start.allDay ? null : e.start.time,
        endTime: e.end && !e.end.allDay && e.end.date === e.start.date ? e.end.time : null,
        allDay,
        selected: blocking.length === 0,
      }),
    );
  }

  return {
    proposals,
    summary: {
      total: proposals.length,
      activities: proposals.filter((p) => p.kindProposal === 'ACTIVITY').length,
      scheduleBlocks: proposals.filter((p) => p.kindProposal === 'SCHEDULE_BLOCK').length,
      needsReview: proposals.filter(
        (p) => p.kindProposal !== 'UNSUPPORTED' && p.status === 'NEEDS_REVIEW',
      ).length,
      unsupported: proposals.filter((p) => p.kindProposal === 'UNSUPPORTED').length,
    },
  };
}

// ── Confirmation ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const confirmIcsItemSchema = z
  .strictObject({
    /** Chosen by the client so an error can be pointed at the card it came from. Never stored. */
    clientId: z.string().min(1).max(64),
    kind: z.enum(['ACTIVITY', 'BLOCK']),
    title: z.string().trim().min(1, 'Ingresa un título.'),
    /** One of the student's own subjects of a CURRENT study (checked on the server), or null. */
    subjectId: z.uuid('Asignatura inválida.').nullable(),
    date: dateOnlySchema,
    startTime: dueTimeSchema.nullish(),
    endTime: dueTimeSchema.nullish(),
    type: z.enum(ACTIVITY_TYPES).optional(),
    description: z.string().max(ACTIVITY_DESCRIPTION_MAX).nullish(),
    /** A block: repeats every week until `until` (null = the end of the period); false = a single block. */
    weekly: z.boolean().optional(),
    until: dateOnlySchema.nullish(),
    allowDuplicate: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'BLOCK') {
      if (!v.startTime)
        ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Falta la hora de inicio.' });
      if (!v.endTime)
        ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Falta la hora de fin.' });
      if (v.startTime && v.endTime && v.endTime <= v.startTime)
        ctx.addIssue({
          code: 'custom',
          path: ['endTime'],
          message: 'La hora de fin debe ser posterior a la de inicio.',
        });
    }
  });
export type ConfirmIcsItem = z.infer<typeof confirmIcsItemSchema>;

export const confirmIcsImportSchema = z
  .strictObject({
    items: z
      .array(confirmIcsItemSchema)
      .min(1, 'Selecciona al menos un evento.')
      .max(ICS_IMPORT_MAX_ITEMS),
  })
  .refine((v) => new Set(v.items.map((i) => i.clientId)).size === v.items.length, {
    path: ['items'],
    message: 'Hay eventos repetidos en la solicitud.',
  });
export type ConfirmIcsImportInput = z.infer<typeof confirmIcsImportSchema>;
export type ConfirmIcsImportRequest = z.input<typeof confirmIcsImportSchema>;

export const ICS_ITEM_ERROR_CODES = [
  'VALIDATION_ERROR',
  'SUBJECT_NOT_FOUND',
  'DUPLICATE_ACTIVITY',
] as const;
export const icsItemErrorSchema = z.object({
  clientId: z.string(),
  code: z.enum(ICS_ITEM_ERROR_CODES),
  message: z.string(),
  fields: z.record(z.string(), z.array(z.string())),
});
export type IcsItemError = z.infer<typeof icsItemErrorSchema>;

export const confirmIcsImportResponseSchema = z.object({
  createdActivities: z.array(z.object({ clientId: z.string(), id: z.uuid(), title: z.string() })),
  createdBlocks: z.array(z.object({ clientId: z.string(), id: z.uuid(), title: z.string() })),
  /** Blocks that were already in the agenda (the same class): reused, not duplicated. */
  reusedBlocks: z.array(z.object({ clientId: z.string(), id: z.uuid(), title: z.string() })),
});
export type ConfirmIcsImportResponse = z.infer<typeof confirmIcsImportResponseSchema>;

export const ICS_DUPLICATE_ACTIVITY_MESSAGE = 'Ya tienes una actividad igual con esa fecha y hora.';
