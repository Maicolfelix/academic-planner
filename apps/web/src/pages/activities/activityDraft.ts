import { z } from 'zod';

/**
 * What an activity form keeps between visits (see lib/drafts). One draft per user for a NEW activity of a period, and one per
 * activity for an edit. It stores what the student typed or chose and nothing transient (loading, errors, focus).
 *
 * `base` is the `updatedAt` of the activity when the edit started: if the activity changed on the server since, the draft
 * is not applied silently — the student chooses.
 */
export const activityDraftSchema = z.object({
  title: z.string().max(500),
  subjectId: z.string().max(64),
  subjectless: z.boolean(),
  dueDate: z.string().max(10),
  dueTime: z.string().max(5),
  type: z.string().max(30),
  priority: z.string().max(30),
  status: z.string().max(30),
  description: z.string().max(5000),
  /** The inline "Nueva asignatura" is open with this name typed (not created); null: closed. */
  creatorName: z.string().max(300).nullable(),
  base: z.string().max(40).nullable(),
});
export type ActivityDraft = z.infer<typeof activityDraftSchema>;

export const activityDraftScope = (activityId: string | undefined, periodId: string | undefined) =>
  activityId ? `activity-edit:${activityId}` : `activity-create:${periodId ?? 'none'}`;

/** A draft with nothing typed is not worth keeping. */
export const isBlank = (d: ActivityDraft) =>
  d.title.trim() === '' && d.dueDate === '' && d.dueTime === '' && d.description.trim() === '';
