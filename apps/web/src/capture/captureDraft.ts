import {
  ACTIVITY_TYPES,
  CAPTURE_ENGINE_VERSION,
  captureCorrectionSchema,
  captureProposalSchema,
  recurrenceSuggestionSchema,
  type CaptureMode,
} from '@planner/core';
import { z } from 'zod';
import type { ReviewState } from './reviewModel';

/**
 * What a half-done capture keeps between visits: the text, and — once it was interpreted — the proposals with everything the
 * student already decided (ticks, answers to shared questions, individual changes, subjects still to be created). Coming
 * back shows it exactly as it was; nothing is interpreted again.
 *
 * Validated on the way in: a draft from another version of the engine, or one that no longer has the shape, is dropped.
 */

const subjectChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }),
  z.object({ kind: z.literal('EXISTING'), id: z.string(), name: z.string() }),
  z.object({ kind: z.literal('NEW'), name: z.string().max(200) }),
]);

const reviewSchema = z.object({
  items: z.array(
    z.object({
      proposal: captureProposalSchema,
      selected: z.boolean(),
      selectionTouched: z.boolean(),
      allowDuplicate: z.boolean(),
      title: z.string().max(500).optional(),
      type: z.enum(ACTIVITY_TYPES).optional(),
      date: z.string().max(10).optional(),
      time: z.string().max(5).optional(),
      subject: subjectChoice.optional(),
    }),
  ),
  groupTime: z.record(z.string(), z.string()),
  groupSubject: z.record(z.string(), subjectChoice),
  corrections: z.array(captureCorrectionSchema),
  suggestions: z.array(recurrenceSuggestionSchema),
});

export const captureDraftSchema = z.object({
  engine: z.literal(CAPTURE_ENGINE_VERSION),
  text: z.string().max(20_000),
  review: reviewSchema.nullable(),
});
export type CaptureDraft = z.infer<typeof captureDraftSchema>;

export const captureDraftScope = (mode: CaptureMode) => `capture-${mode.toLowerCase()}`;

/** The draft to store; null when there is nothing worth keeping (no text and nothing interpreted). */
export function toCaptureDraft(text: string, review: ReviewState | null): CaptureDraft | null {
  if (text.trim() === '' && review === null) return null;
  return {
    engine: CAPTURE_ENGINE_VERSION,
    text,
    review: review && {
      items: review.items.map(({ error: _error, ...item }) => item),
      groupTime: review.groupTime,
      groupSubject: review.groupSubject,
      corrections: review.corrections,
      suggestions: review.suggestions,
    },
  };
}

export function fromCaptureDraft(draft: CaptureDraft): {
  text: string;
  review: ReviewState | null;
} {
  return { text: draft.text, review: draft.review };
}
