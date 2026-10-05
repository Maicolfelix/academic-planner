import { z } from 'zod';
import { periodSchema } from './academic.js';
import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_TYPE } from './activity.js';
import {
  FIELD_CERTAINTIES,
  QUICK_CAPTURE_FIELDS,
  QUICK_CAPTURE_MESSAGES,
  QUICK_CAPTURE_TYPE_ALIASES,
  QUICK_CAPTURE_WARNING_CODES,
  interpretTokens,
  tokenize,
  type QuickCaptureContext,
} from './captureShared.js';

/**
 * QUICK CAPTURE: turns a short phrase ("parcial redes martes 10am") into a PROPOSAL for an Activity.
 *
 * It is a deterministic parser: normalisation, tokenisation, small dictionaries and anchored regular
 * expressions (the pieces live in captureShared.ts, which the Academic Inbox reuses). No AI, no remote service,
 * nothing is stored and nothing is created here: the flow is always CAPTURE -> INTERPRET -> CONFIRM, and only the
 * student's confirmation creates an Activity (through the normal Activity API). `now` is injected so every date
 * rule is testable. See docs/quick-capture.md.
 */

export {
  FIELD_CERTAINTIES,
  QUICK_CAPTURE_FIELDS,
  QUICK_CAPTURE_MESSAGES,
  QUICK_CAPTURE_TYPE_ALIASES,
  QUICK_CAPTURE_WARNING_CODES,
};
export type { FieldCertainty, QuickCaptureContext, QuickCaptureField } from './captureShared.js';

export const QUICK_CAPTURE_MAX_LENGTH = 300;
/** Hard cap of the request body: far above the product limit, only a guard against abuse. */
export const QUICK_CAPTURE_REQUEST_MAX = 2000;

// ───────────────────────── Result ─────────────────────────

const subjectRef = z.object({ id: z.uuid(), name: z.string() });
const certainty = z.enum(FIELD_CERTAINTIES);

export const quickCaptureResultSchema = z.object({
  rawText: z.string(),
  /** OK, or why nothing was interpreted. A partial understanding is still OK: the UI asks for the rest. */
  status: z.enum(['OK', 'EMPTY', 'TOO_LONG']),
  /** Type label + the text left over, or that text alone when no type was recognised. */
  title: z.string(),
  /** TASK when none was recognised (see `certainty.type`), exactly like a manually created activity. */
  type: z.enum(ACTIVITY_TYPES),
  subjectId: z.uuid().nullable(),
  dueDate: z.string().nullable(),
  /** HH:mm, 24 hours. null = no time (the activity is due at the end of the day). */
  dueTime: z.string().nullable(),
  hasTime: z.boolean(),
  certainty: z.object({ type: certainty, subject: certainty, date: certainty, time: certainty }),
  recognizedFields: z.array(z.enum(QUICK_CAPTURE_FIELDS)),
  /** Required to create an Activity and not found: title, subject and date. */
  missingFields: z.array(z.enum(['title', 'subject', 'date'])),
  ambiguities: z.array(z.object({ field: z.literal('subject'), candidates: z.array(subjectRef) })),
  warnings: z.array(z.object({ code: z.enum(QUICK_CAPTURE_WARNING_CODES), message: z.string() })),
});

export type QuickCaptureResult = z.infer<typeof quickCaptureResultSchema>;

/** POST /api/quick-capture/parse. Strict: nothing but `text`. */
export const quickCaptureRequestSchema = z.strictObject({
  text: z
    .string({ error: QUICK_CAPTURE_MESSAGES.EMPTY })
    .max(QUICK_CAPTURE_REQUEST_MAX, QUICK_CAPTURE_MESSAGES.TOO_LONG),
});
export type QuickCaptureRequest = z.infer<typeof quickCaptureRequestSchema>;

export const quickCaptureResponseSchema = z.object({
  capture: quickCaptureResultSchema,
  period: periodSchema.nullable(),
});
export type QuickCaptureResponse = z.infer<typeof quickCaptureResponseSchema>;

// ───────────────────────── Parser ─────────────────────────

function emptyResult(rawText: string, status: 'EMPTY' | 'TOO_LONG'): QuickCaptureResult {
  return {
    rawText,
    status,
    title: '',
    type: DEFAULT_ACTIVITY_TYPE,
    subjectId: null,
    dueDate: null,
    dueTime: null,
    hasTime: false,
    certainty: { type: 'MISSING', subject: 'MISSING', date: 'MISSING', time: 'MISSING' },
    recognizedFields: [],
    missingFields: ['title', 'subject', 'date'],
    ambiguities: [],
    warnings: [{ code: status, message: QUICK_CAPTURE_MESSAGES[status] }],
  };
}

/**
 * Interprets a short phrase. It never throws and never gives up on partial understanding: it returns what it
 * understood and lists what is missing, so the student completes the rest in the preview.
 *
 * Date rules (all on the user's local calendar, `context.timeZone`):
 *  - "hoy", "mañana", "pasado mañana";
 *  - a weekday name (or "este martes") is the NEXT occurrence of that day, today included; "próximo martes" is
 *    the next one AFTER today; if it is today and an explicit time has already passed, it becomes the same day of
 *    next week (without a time it stays today);
 *  - DD/MM, DD-MM and DD/MM/YYYY (day first, never MM/DD) and "10 de octubre" / "10 octubre" / "octubre 10";
 *  - without a year, the next occurrence of that day and month (today included).
 * A date outside the current period is kept and flagged, never silently corrected.
 */
export function parseQuickCapture(input: string, context: QuickCaptureContext): QuickCaptureResult {
  const trimmed = input.trim();
  if (trimmed === '') return emptyResult(input, 'EMPTY');
  if (trimmed.length > QUICK_CAPTURE_MAX_LENGTH) return emptyResult(input, 'TOO_LONG');

  const { meta: _meta, ...interpretation } = interpretTokens(tokenize(trimmed), context);
  void _meta; // the origin of shared words only matters to the Academic Inbox
  return { rawText: input, status: 'OK', ...interpretation };
}
