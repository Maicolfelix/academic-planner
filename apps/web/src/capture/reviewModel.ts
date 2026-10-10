import {
  normalizeNameKey,
  type ActivityType,
  type CaptureConfirmRequest,
  type CaptureCorrection,
  type CaptureProposal,
  type CaptureResult,
  type RecurrenceSuggestion,
  type Subject,
} from '@planner/core';

/**
 * THE REVIEW MODEL: what the student sees and decides between "the app understood this" and "create it", as plain data
 * and pure functions (no React, no network). Quick Capture and the Inbox share it.
 *
 * Principle: the engine already decided everything it could. A proposal that needs nothing is READY and starts ticked; the
 * student only touches what is really in doubt, and a doubt several proposals share is answered ONCE. Whatever the student
 * changes on ONE proposal stays on it: from then on it no longer follows the shared answer.
 */

/** What the student decided for the subject of one proposal. NEW is only a name: it is created when everything is confirmed. */
export type SubjectChoice =
  { kind: 'NONE' } | { kind: 'EXISTING'; id: string; name: string } | { kind: 'NEW'; name: string };

export type PendingField = 'title' | 'date' | 'time' | 'subject';

export interface ReviewItem {
  proposal: CaptureProposal;
  selected: boolean;
  /** The student ticked or unticked it: from then on it no longer ticks itself when it becomes complete. */
  selectionTouched: boolean;
  /** Ticked a copy of an activity the student already has, on purpose. */
  allowDuplicate: boolean;
  /** Individual changes (overrides). `undefined`: it is what the engine understood (or the shared answer). */
  title?: string;
  type?: ActivityType;
  date?: string;
  /** 'HH:mm', or '' for "sin hora". */
  time?: string;
  subject?: SubjectChoice;
  /** A message from the last attempt to create it (the server refused this one). */
  error?: string;
}

export interface ReviewState {
  items: ReviewItem[];
  /** The answers to shared questions: the hour of a time group ('' = no time), the subject of a subject group. */
  groupTime: Record<string, string>;
  groupSubject: Record<string, SubjectChoice>;
  corrections: CaptureCorrection[];
  suggestions: RecurrenceSuggestion[];
}

// ───────────────────────── Building ─────────────────────────

export function createReview(
  result: Pick<CaptureResult, 'proposals' | 'corrections' | 'suggestions'>,
): ReviewState {
  return {
    items: result.proposals.map((proposal) => ({
      proposal,
      selected: proposal.selected,
      selectionTouched: false,
      allowDuplicate: false,
    })),
    groupTime: {},
    groupSubject: {},
    corrections: result.corrections,
    suggestions: result.suggestions,
  };
}

// ───────────────────────── Effective values ─────────────────────────

/** The shared subject question this proposal belongs to, if any (a question several proposals have). */
export function subjectCorrectionOf(
  state: ReviewState,
  item: ReviewItem,
): CaptureCorrection | null {
  return (
    state.corrections.find(
      (c) => c.field === 'subject' && c.clientIds.includes(item.proposal.clientId),
    ) ?? null
  );
}

/** The shared hour question this proposal belongs to, if any. */
export function timeCorrectionOf(state: ReviewState, item: ReviewItem): CaptureCorrection | null {
  const key = item.proposal.time.groupKey;
  if (key === null) return null;
  return state.corrections.find((c) => c.field === 'time' && c.key === key) ?? null;
}

export const effectiveTitle = (item: ReviewItem) => item.title ?? item.proposal.title.value;
export const effectiveType = (item: ReviewItem): ActivityType =>
  item.type ?? item.proposal.type.value;
export const effectiveDate = (item: ReviewItem) => item.date ?? item.proposal.date.value ?? '';

/** The subject chosen for it, or undefined while the student still has to decide. */
export function effectiveSubject(state: ReviewState, item: ReviewItem): SubjectChoice | undefined {
  if (item.subject) return item.subject;
  const s = item.proposal.subject;
  if (s.kind === 'EXISTING') return { kind: 'EXISTING', id: s.id, name: s.name };
  if (s.kind === 'NONE') return { kind: 'NONE' };
  const correction = subjectCorrectionOf(state, item);
  return correction ? state.groupSubject[correction.key] : undefined;
}

/** 'HH:mm', '' (no time) or undefined while the hour is still a question. */
export function effectiveTime(state: ReviewState, item: ReviewItem): string | undefined {
  if (item.time !== undefined) return item.time;
  const t = item.proposal.time;
  const correction = timeCorrectionOf(state, item);
  if (correction && state.groupTime[correction.key] !== undefined) {
    return state.groupTime[correction.key];
  }
  if (t.certainty === 'AMBIGUOUS' || hasBlocking(item.proposal, 'time')) return undefined;
  return t.value ?? '';
}

const hasBlocking = (p: CaptureProposal, field: PendingField) =>
  p.blockingIssues.some((b) => b.field === field);

/** What the student still has to settle on this proposal before it can be created. */
export function pendingOf(state: ReviewState, item: ReviewItem): PendingField[] {
  const out: PendingField[] = [];
  if (effectiveTitle(item).trim() === '') out.push('title');
  const date = effectiveDate(item);
  const dateInDoubt = item.date === undefined && item.proposal.date.certainty === 'AMBIGUOUS';
  if (date === '' || dateInDoubt) out.push('date');
  if (effectiveTime(state, item) === undefined) out.push('time');
  if (effectiveSubject(state, item) === undefined) out.push('subject');
  return out;
}

export const isComplete = (state: ReviewState, item: ReviewItem) =>
  pendingOf(state, item).length === 0;

// ───────────────────────── Changes (each returns a new state) ─────────────────────────

/** An item that has not been ticked or unticked by hand follows its completeness: complete = ticked. */
function settle(state: ReviewState): ReviewState {
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.selectionTouched) return item;
      const wanted = isComplete(state, item) && item.proposal.duplicateOf === null;
      return item.selected === wanted ? item : { ...item, selected: wanted };
    }),
  };
}

const patchItem = (state: ReviewState, clientId: string, patch: Partial<ReviewItem>): ReviewState =>
  settle({
    ...state,
    items: state.items.map((i) =>
      i.proposal.clientId === clientId ? { ...i, error: undefined, ...patch } : i,
    ),
  });

export const setTitle = (s: ReviewState, id: string, title: string) => patchItem(s, id, { title });
export const setType = (s: ReviewState, id: string, type: ActivityType) =>
  patchItem(s, id, { type });
export const setDate = (s: ReviewState, id: string, date: string) => patchItem(s, id, { date });
/** An individual hour: this proposal stops following the shared answer. '' = no time. */
export const setTime = (s: ReviewState, id: string, time: string) => patchItem(s, id, { time });
export const setSubject = (s: ReviewState, id: string, subject: SubjectChoice) =>
  patchItem(s, id, { subject });

/** The shared answer to an hour question: every proposal of the group that was not changed by hand takes it. */
export const chooseGroupTime = (state: ReviewState, key: string, time: string): ReviewState =>
  settle({ ...state, groupTime: { ...state.groupTime, [key]: time } });

export const chooseGroupSubject = (
  state: ReviewState,
  key: string,
  choice: SubjectChoice,
): ReviewState => settle({ ...state, groupSubject: { ...state.groupSubject, [key]: choice } });

export const toggle = (state: ReviewState, clientId: string, selected: boolean): ReviewState => ({
  ...state,
  items: state.items.map((i) =>
    i.proposal.clientId === clientId
      ? {
          ...i,
          selected,
          selectionTouched: true,
          // Ticking a copy of something that already exists is saying "yes, I want it again".
          allowDuplicate: selected && i.proposal.duplicateOf !== null,
        }
      : i,
  ),
});

/** Takes proposals out of the review (the ones created, or the one the student does not want). */
export const removeAll = (state: ReviewState, clientIds: ReadonlySet<string>): ReviewState => ({
  ...state,
  items: state.items.filter((i) => !clientIds.has(i.proposal.clientId)),
  corrections: state.corrections
    .map((c) => ({ ...c, clientIds: c.clientIds.filter((id) => !clientIds.has(id)) }))
    .filter((c) => c.clientIds.length >= 2),
});

export const remove = (state: ReviewState, clientId: string): ReviewState =>
  removeAll(state, new Set([clientId]));

export const setError = (state: ReviewState, errors: Record<string, string>): ReviewState => ({
  ...state,
  items: state.items.map((i) => ({ ...i, error: errors[i.proposal.clientId] })),
});

/** Subjects the student chose that no longer exist (deleted meanwhile) go back to being a question. */
export function reconcileSubjects(state: ReviewState, subjects: readonly Subject[]): ReviewState {
  const alive = new Set(subjects.map((s) => s.id));
  const keep = (c: SubjectChoice | undefined) =>
    c && c.kind === 'EXISTING' && !alive.has(c.id) ? undefined : c;
  const groupSubject = Object.fromEntries(
    Object.entries(state.groupSubject).filter(([, c]) => keep(c) !== undefined),
  );
  return settle({
    ...state,
    groupSubject,
    items: state.items.map((i) =>
      keep(i.subject) === i.subject ? i : { ...i, subject: undefined },
    ),
  });
}

// ───────────────────────── Reading the whole review ─────────────────────────

export interface ReviewSummary {
  total: number;
  /** Ticked and complete: what "Crear N" creates. */
  toCreate: number;
  /** Ticked but still missing something: the button waits. */
  incomplete: number;
  /** Not ticked. */
  skipped: number;
  /** New subjects that confirming will create, once each. */
  newSubjects: string[];
}

export function summarize(state: ReviewState): ReviewSummary {
  let toCreate = 0;
  let incomplete = 0;
  let skipped = 0;
  const names = new Map<string, string>();
  for (const item of state.items) {
    if (!item.selected) {
      skipped++;
      continue;
    }
    if (!isComplete(state, item)) {
      incomplete++;
      continue;
    }
    toCreate++;
    const subject = effectiveSubject(state, item);
    if (subject?.kind === 'NEW') names.set(normalizeNameKey(subject.name), subject.name.trim());
  }
  return {
    total: state.items.length,
    toCreate,
    incomplete,
    skipped,
    newSubjects: [...names.values()],
  };
}

/** The request that creates what is ticked. Only complete ones go: the button never offers more than that. */
export function buildConfirmRequest(state: ReviewState): CaptureConfirmRequest {
  const items: CaptureConfirmRequest['items'] = [];
  for (const item of state.items) {
    if (!item.selected || !isComplete(state, item)) continue;
    const subject = effectiveSubject(state, item)!;
    const time = effectiveTime(state, item);
    items.push({
      clientId: item.proposal.clientId,
      title: effectiveTitle(item).trim(),
      type: effectiveType(item),
      dueDate: effectiveDate(item),
      ...(time ? { dueTime: time } : {}),
      subject:
        subject.kind === 'EXISTING'
          ? { kind: 'EXISTING', subjectId: subject.id }
          : subject.kind === 'NEW'
            ? { kind: 'NEW', name: subject.name.trim() }
            : { kind: 'NONE' },
      ...(item.allowDuplicate ? { allowDuplicate: true } : {}),
    });
  }
  return { items };
}
