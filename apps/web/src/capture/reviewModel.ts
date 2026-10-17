import {
  ACTIVITY_DESCRIPTION_MAX,
  formatPoints,
  formatScore,
  normalizeNameKey,
  resolveGrade,
  type ActivityType,
  type CaptureConfirmRequest,
  type CaptureCorrection,
  type CaptureProposal,
  type CaptureResult,
  type GradeResolution,
  type GradeSelection,
  type GradeSuggestion,
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

export type PendingField = 'title' | 'date' | 'time' | 'subject' | 'description';

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
  /** Optional context for the activity; '' = none (also the answer to "do not use the offered one"). */
  description?: string;
  /** A message from the last attempt to create it (the server refused this one). */
  error?: string;
}

export type RecurrencePending = 'title' | 'subject' | 'days' | 'start' | 'end';

/**
 * A weekly schedule the engine understood ("Ciberseguridad todos los martes y jueves de 6 a 8") and what the student
 * decided about it. One card = one subject and its weekdays; each weekday becomes one weekly block when confirmed.
 */
export interface ReviewRecurrence {
  suggestion: RecurrenceSuggestion;
  selected: boolean;
  selectionTouched: boolean;
  title?: string;
  subject?: SubjectChoice;
  /** The weekdays (1 = Monday) chosen by hand; undefined = the ones the engine read. */
  days?: number[];
  /** Times typed for ONE weekday ('HH:mm'). */
  times?: Record<string, { start?: string; end?: string }>;
  /** "¿Hasta qué hora?" answered once: the end of every day that has none (the start, the same way). */
  sharedEnd?: string;
  sharedStart?: string;
  /** A message from the last attempt to create it. */
  error?: string;
}

/**
 * A grade the engine understood ("Saqué 4.3 en el Corte 2 de Farmacología", "Parcial de Anatomía… vale 40 % del Corte 1") and what
 * the student decided about it. `selection` only holds the answers to what was in doubt; the rest is what the words settled.
 */
export interface ReviewGrade {
  suggestion: GradeSuggestion;
  selected: boolean;
  selectionTouched: boolean;
  selection: GradeSelection;
  /** A message from the last attempt to save it. */
  error?: string;
}

export interface ReviewState {
  items: ReviewItem[];
  /** The grades found: scores, cut grades and new evaluations. */
  grades: ReviewGrade[];
  /** The weekly schedules found (also the ones that cannot be created yet: they are only shown). */
  recurrences: ReviewRecurrence[];
  /** The answers to shared questions: the hour of a time group ('' = no time), the subject of a subject group. */
  groupTime: Record<string, string>;
  groupSubject: Record<string, SubjectChoice>;
  corrections: CaptureCorrection[];
  /** Something to read before ticking anything ("Dijiste que eran 3 actividades, pero solo pude identificar 2."). */
  notice?: string | null;
}

// ───────────────────────── Building ─────────────────────────

export function createReview(
  result: Pick<CaptureResult, 'proposals' | 'corrections' | 'suggestions' | 'warnings'>,
  grades: readonly GradeSuggestion[] = [],
): ReviewState {
  // The count the student announced does not match what was found: nothing is ticked until they have looked (and what they
  // tick by hand stays as they left it).
  const mismatch = result.warnings.find((w) => w.code === 'COUNT_MISMATCH');
  return {
    notice: mismatch?.message ?? null,
    items: result.proposals.map((proposal) => ({
      proposal,
      selected: mismatch ? false : proposal.selected,
      selectionTouched: mismatch !== undefined,
      allowDuplicate: false,
    })),
    grades: grades.map((suggestion) => ({
      suggestion,
      selected: mismatch ? false : suggestion.selected && suggestion.status === 'READY',
      selectionTouched: mismatch !== undefined,
      selection: {},
    })),
    groupTime: {},
    groupSubject: {},
    corrections: result.corrections,
    recurrences: result.suggestions.map((suggestion) => ({
      suggestion,
      selected: suggestion.selected && suggestion.kind === 'WEEKLY_SCHEDULE',
      selectionTouched: false,
    })),
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

/**
 * The title: the student's own edit, else every word the engine read. When the subject was only an OFFERED name ("parcial de
 * ciberseguridad") and the student accepts a subject for it, the name is the subject and the title is the shorter one.
 */
export function effectiveTitle(state: ReviewState, item: ReviewItem): string {
  if (item.title !== undefined) return item.title;
  const { value, withoutSubject } = item.proposal.title;
  const subject = effectiveSubject(state, item);
  const offered =
    item.proposal.subject.kind === 'UNRESOLVED' ? item.proposal.subject.suggestedName : null;
  const accepted =
    offered !== null &&
    (subject?.kind === 'NEW' || subject?.kind === 'EXISTING') &&
    normalizeNameKey(subject.name) === normalizeNameKey(offered);
  return withoutSubject !== null && accepted ? withoutSubject : value;
}
export const effectiveType = (item: ReviewItem): ActivityType =>
  item.type ?? item.proposal.type.value;
export const effectiveDate = (item: ReviewItem) => item.date ?? item.proposal.date.value ?? '';
export const effectiveDescription = (item: ReviewItem) =>
  item.description ?? item.proposal.description.value ?? '';

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
  if (effectiveTitle(state, item).trim() === '') out.push('title');
  const date = effectiveDate(item);
  const dateInDoubt = item.date === undefined && item.proposal.date.certainty === 'AMBIGUOUS';
  if (date === '' || dateInDoubt) out.push('date');
  if (effectiveTime(state, item) === undefined) out.push('time');
  if (effectiveSubject(state, item) === undefined) out.push('subject');
  // Words about the activity that could not be tied to one: the student says whether this is its description.
  if (item.description === undefined && hasBlocking(item.proposal, 'description')) {
    out.push('description');
  }
  return out;
}

export const isComplete = (state: ReviewState, item: ReviewItem) =>
  pendingOf(state, item).length === 0;

// ───────────────────────── Changes (each returns a new state) ─────────────────────────

/**
 * The activity of a sentence like "Parcial de Inglés el viernes, vale 40 % de la Etapa 1" is added to the Agenda of HOME. When the
 * student's chosen subject for the grade belongs to ANOTHER study, that activity would land in the wrong place: it is blocked
 * (never ticked, never sent), so one sentence is never split across studies.
 */
export function agendaBlocked(state: ReviewState, clientId: string): boolean {
  return state.grades.some((g) => {
    if (g.suggestion.activityClientId !== clientId) return false;
    const option = gradeResolution(g).option;
    return option !== null && !option.subject.isHome;
  });
}

/** An item that has not been ticked or unticked by hand follows its completeness: complete = ticked. */
function settle(state: ReviewState): ReviewState {
  return {
    ...state,
    items: state.items.map((item) => {
      const blocked = agendaBlocked(state, item.proposal.clientId);
      // Blocked: unticked, and it forgets any manual tick so that it follows its completeness again once unblocked.
      if (blocked)
        return item.selected || item.selectionTouched
          ? { ...item, selected: false, selectionTouched: false }
          : item;
      if (item.selectionTouched) return item;
      const wanted = isComplete(state, item) && item.proposal.duplicateOf === null;
      return item.selected === wanted ? item : { ...item, selected: wanted };
    }),
    grades: state.grades.map((g) => {
      if (g.selectionTouched) return g;
      const wanted = isGradeComplete(g);
      return g.selected === wanted ? g : { ...g, selected: wanted };
    }),
    recurrences: state.recurrences.map((r) => {
      if (r.selectionTouched || !isCreatable(r)) return r;
      const wanted = isRecurrenceComplete(r);
      return r.selected === wanted ? r : { ...r, selected: wanted };
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
/** '' = none. Never longer than the server accepts (the field stops there too). */
export const setDescription = (s: ReviewState, id: string, description: string) =>
  patchItem(s, id, { description: description.slice(0, ACTIVITY_DESCRIPTION_MAX) });

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
          // An activity whose subject-of-grade belongs to another study can never be ticked.
          selected: selected && !agendaBlocked(state, clientId),
          selectionTouched: true,
          // Ticking a copy of something that already exists is saying "yes, I want it again".
          allowDuplicate:
            selected && !agendaBlocked(state, clientId) && i.proposal.duplicateOf !== null,
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

// ───────────────────────── Grades ─────────────────────────

export const gradeResolution = (g: ReviewGrade): GradeResolution =>
  resolveGrade(g.suggestion, g.selection);
export const isGradeComplete = (g: ReviewGrade) => gradeResolution(g).request !== null;

const patchGrade = (state: ReviewState, clientId: string, patch: Partial<GradeSelection>) =>
  settle({
    ...state,
    grades: state.grades.map((g) =>
      g.suggestion.clientId === clientId
        ? { ...g, error: undefined, selection: { ...g.selection, ...patch } }
        : g,
    ),
  });

/** Another subject: what depended on the previous one (the cut, the conversion) is asked again. */
export const setGradeSubject = (s: ReviewState, id: string, optionIndex: number) =>
  patchGrade(s, id, { optionIndex, choiceIndex: undefined, canonicalMilli: undefined });
export const setGradeTarget = (s: ReviewState, id: string, choiceIndex: number) =>
  patchGrade(s, id, { choiceIndex });
export const setGradeBasis = (s: ReviewState, id: string, basis: 'GRADING_PERIOD' | 'FINAL') =>
  patchGrade(s, id, { basis });
export const setGradeCanonical = (s: ReviewState, id: string, canonicalMilli: number | null) =>
  patchGrade(s, id, { canonicalMilli });
export const setGradeName = (s: ReviewState, id: string, name: string) =>
  patchGrade(s, id, { name });

export const toggleGrade = (
  state: ReviewState,
  clientId: string,
  selected: boolean,
): ReviewState => ({
  ...state,
  grades: state.grades.map((g) =>
    g.suggestion.clientId === clientId ? { ...g, selected, selectionTouched: true } : g,
  ),
});

export const removeGrades = (state: ReviewState, clientIds: ReadonlySet<string>): ReviewState => ({
  ...state,
  grades: state.grades.filter((g) => !clientIds.has(g.suggestion.clientId)),
});

export interface GradeView {
  /** "Farmacología" — or what is still to decide. */
  subject: string;
  /** "Corte 2", or null while unknown. */
  cut: string | null;
  /** "Nota: 4.3" / "Nota: Pendiente" / null while unknown. */
  score: string | null;
  /** "Corte 1 · 40 %" for a new evaluation. */
  weight: string | null;
  /** What the card is about: the name of the evaluation, or "Nota del corte". */
  title: string;
  /** What this will do, in words ("Se guardará…"). */
  action: string;
}

/** The card of a grade in plain words: never an internal term (scoreMilli, basis points, isCutGrade…). */
export function gradeView(g: ReviewGrade): GradeView {
  const r = gradeResolution(g);
  const s = g.suggestion;
  const decimals = r.option?.profile?.decimals ?? 1;
  const choice = r.choice;
  const cut =
    choice && choice.action !== 'SCORE_EVALUATION'
      ? choice.cut.name
      : choice
        ? choice.evaluation.cutName
        : null;
  const points =
    s.score.kind === 'POINTS' && s.score.rawEarnedMilli !== null && s.score.rawMaxMilli !== null
      ? formatPoints(s.score.rawEarnedMilli, s.score.rawMaxMilli)
      : null;
  const shown = r.scoreMilli !== null ? formatScore(r.scoreMilli, decimals) : null;
  const score =
    choice?.action === 'CREATE_EVALUATION' && s.score.kind === 'NONE'
      ? 'Nota: Pendiente'
      : shown !== null
        ? `Nota: ${shown}${points ? ` (${points})` : ''}`
        : points
          ? `Nota: ${points}`
          : null;
  const pct = s.weight.percentBp === null ? null : `${s.weight.percentBp / 100} %`;
  const weight =
    choice?.action === 'CREATE_EVALUATION' && r.periodShareBp !== null
      ? `${choice.cut.name} · ${r.periodShareBp / 100} %`
      : s.intent === 'NEW_EVALUATION' && pct
        ? pct
        : null;
  const title =
    choice?.action === 'SCORE_EVALUATION'
      ? choice.evaluation.name
      : s.intent === 'NEW_EVALUATION'
        ? (g.selection.name ?? s.name ?? 'Evaluación')
        : 'Nota del corte';
  const action =
    choice?.action === 'CREATE_EVALUATION'
      ? 'Se agregará esta evaluación a la materia.'
      : choice?.action === 'UPDATE_CUT_GRADE'
        ? 'Cambiará la nota que ya tenías en este corte.'
        : choice
          ? 'Se guardará esta nota.'
          : 'Falta decidir dónde va.';
  return {
    subject: r.option?.subject.name ?? 'Asignatura por decidir',
    cut,
    score,
    weight,
    title,
    action,
  };
}

// ───────────────────────── Weekly schedules ─────────────────────────

/** A schedule the app can create. A repeating ACTIVITY ("un quiz todos los viernes") is only shown. */
export const isCreatable = (r: ReviewRecurrence) => r.suggestion.kind === 'WEEKLY_SCHEDULE';

export const effectiveRecurrenceTitle = (r: ReviewRecurrence): string =>
  r.title ?? r.suggestion.title.value ?? '';

/** The subject chosen, or undefined while the student still has to decide. */
export function effectiveRecurrenceSubject(r: ReviewRecurrence): SubjectChoice | undefined {
  if (r.subject) return r.subject;
  const s = r.suggestion.subject;
  if (s.kind === 'EXISTING') return { kind: 'EXISTING', id: s.id, name: s.name };
  if (s.kind === 'NONE') return { kind: 'NONE' };
  return undefined;
}

export interface EffectiveSlot {
  weekday: number;
  /** 'HH:mm', or '' while it is a question. */
  start: string;
  end: string;
}

/** The weekdays and their two times as they would be created. An added weekday starts like the first one. */
export function effectiveSlots(r: ReviewRecurrence): EffectiveSlot[] {
  const read = r.suggestion.slots;
  const days = [...new Set(r.days ?? read.map((x) => x.weekday))].sort((a, b) => a - b);
  const first = read[0];
  return days.map((weekday) => {
    const own = r.times?.[String(weekday)];
    const base = read.find((x) => x.weekday === weekday) ?? first;
    return {
      weekday,
      start: own?.start ?? base?.time.value ?? r.sharedStart ?? '',
      end: own?.end ?? base?.endTime.value ?? r.sharedEnd ?? '',
    };
  });
}

/** What the student still has to settle before this schedule can be created. */
export function recurrencePendingOf(r: ReviewRecurrence): RecurrencePending[] {
  const out: RecurrencePending[] = [];
  if (effectiveRecurrenceTitle(r).trim() === '') out.push('title');
  const subject = effectiveRecurrenceSubject(r);
  // A class belongs to a subject; a study session may have none.
  if (subject === undefined || (r.suggestion.blockType === 'CLASS' && subject.kind === 'NONE')) {
    out.push('subject');
  }
  const slots = effectiveSlots(r);
  if (slots.length === 0) out.push('days');
  if (slots.some((x) => x.start === '')) out.push('start');
  if (slots.some((x) => x.end === '' || (x.start !== '' && x.end <= x.start))) out.push('end');
  return out;
}

export const isRecurrenceComplete = (r: ReviewRecurrence) =>
  isCreatable(r) && recurrencePendingOf(r).length === 0;

const patchRecurrence = (
  state: ReviewState,
  clientId: string,
  patch: (r: ReviewRecurrence) => Partial<ReviewRecurrence>,
): ReviewState =>
  settle({
    ...state,
    recurrences: state.recurrences.map((r) =>
      r.suggestion.clientId === clientId ? { ...r, error: undefined, ...patch(r) } : r,
    ),
  });

export const setRecurrenceTitle = (s: ReviewState, id: string, title: string) =>
  patchRecurrence(s, id, () => ({ title }));
export const setRecurrenceSubject = (s: ReviewState, id: string, subject: SubjectChoice) =>
  patchRecurrence(s, id, () => ({ subject }));
export const setRecurrenceSharedEnd = (s: ReviewState, id: string, sharedEnd: string) =>
  patchRecurrence(s, id, () => ({ sharedEnd }));
export const setRecurrenceSharedStart = (s: ReviewState, id: string, sharedStart: string) =>
  patchRecurrence(s, id, () => ({ sharedStart }));
/** A time typed for ONE weekday. */
export const setRecurrenceTime = (
  s: ReviewState,
  id: string,
  weekday: number,
  which: 'start' | 'end',
  value: string,
) =>
  patchRecurrence(s, id, (r) => ({
    times: {
      ...r.times,
      [String(weekday)]: { ...r.times?.[String(weekday)], [which]: value },
    },
  }));
/** Adds or takes out a weekday. */
export const toggleRecurrenceDay = (s: ReviewState, id: string, weekday: number) =>
  patchRecurrence(s, id, (r) => {
    const now = effectiveSlots(r).map((x) => x.weekday);
    return {
      days: now.includes(weekday) ? now.filter((d) => d !== weekday) : [...now, weekday],
    };
  });

export const toggleRecurrence = (state: ReviewState, clientId: string, selected: boolean) => ({
  ...state,
  recurrences: state.recurrences.map((r) =>
    r.suggestion.clientId === clientId ? { ...r, selected, selectionTouched: true } : r,
  ),
});

/** Takes schedules out of the review (the ones created, or the one the student does not want). */
export const removeRecurrences = (
  state: ReviewState,
  clientIds: ReadonlySet<string>,
): ReviewState => ({
  ...state,
  recurrences: state.recurrences.filter((r) => !clientIds.has(r.suggestion.clientId)),
});

/** The client id one weekday of a schedule is sent with, and back: "s1:2" is the Tuesday of "s1". */
export const blockClientId = (recurrenceId: string, weekday: number) =>
  `${recurrenceId}:${weekday}`;
export const recurrenceOfBlock = (blockId: string) => blockId.split(':')[0]!;

export const setError = (state: ReviewState, errors: Record<string, string>): ReviewState => ({
  ...state,
  grades: state.grades.map((g) => ({ ...g, error: errors[g.suggestion.clientId] })),
  items: state.items.map((i) => ({ ...i, error: errors[i.proposal.clientId] })),
  recurrences: state.recurrences.map((r) => ({
    ...r,
    error: Object.entries(errors).find(
      ([id]) => recurrenceOfBlock(id) === r.suggestion.clientId,
    )?.[1],
  })),
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
    recurrences: state.recurrences.map((r) =>
      keep(r.subject) === r.subject ? r : { ...r, subject: undefined },
    ),
  });
}

// ───────────────────────── Reading the whole review ─────────────────────────

export interface ReviewSummary {
  /** The activities found. */
  total: number;
  /** The weekly schedules found that can be created. */
  schedules: number;
  /** Repeating activities understood but not creatable yet. */
  unsupported: number;
  /** Weekly blocks that confirming will create (one per weekday of a ticked, complete schedule). */
  blocksToCreate: number;
  /** Missing something the student has to decide, ticked or not. */
  needsReview: number;
  /** Ticked and complete: what "Crear N" creates. */
  toCreate: number;
  /** Ticked but still missing something: the button waits. */
  incomplete: number;
  /** Not ticked. */
  skipped: number;
  /** The grades found. */
  grades: number;
  /** Ticked and complete grades: what confirming saves. */
  gradesToCreate: number;
  /** New subjects that confirming will create, once each. */
  newSubjects: string[];
}

export function summarize(state: ReviewState): ReviewSummary {
  let toCreate = 0;
  let incomplete = 0;
  let skipped = 0;
  let needsReview = 0;
  const names = new Map<string, string>();
  let blocksToCreate = 0;
  let gradesToCreate = 0;
  for (const g of state.grades) {
    const complete = isGradeComplete(g);
    if (!complete) needsReview++;
    if (!g.selected) skipped++;
    else if (!complete) incomplete++;
    else gradesToCreate++;
  }
  const creatable = state.recurrences.filter(isCreatable);
  for (const r of creatable) {
    if (!isRecurrenceComplete(r)) needsReview++;
    if (!r.selected) {
      skipped++;
      continue;
    }
    if (!isRecurrenceComplete(r)) {
      incomplete++;
      continue;
    }
    blocksToCreate += effectiveSlots(r).length;
    const subject = effectiveRecurrenceSubject(r);
    if (subject?.kind === 'NEW') names.set(normalizeNameKey(subject.name), subject.name.trim());
  }
  for (const item of state.items) {
    const blocked = agendaBlocked(state, item.proposal.clientId);
    if (!isComplete(state, item) && !blocked) needsReview++;
    if (!item.selected || blocked) {
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
    schedules: creatable.length,
    unsupported: state.recurrences.length - creatable.length,
    blocksToCreate,
    needsReview,
    toCreate,
    incomplete,
    skipped,
    grades: state.grades.length,
    gradesToCreate,
    newSubjects: [...names.values()],
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the button says it will do: "Crear 2 actividades", "Crear horario", "Crear 1 actividad y 2 bloques". */
export function confirmLabel(summary: ReviewSummary, busy = false): string {
  const { toCreate, blocksToCreate, gradesToCreate } = summary;
  if (busy) return gradesToCreate > 0 ? 'Guardando…' : 'Creando…';
  if (gradesToCreate > 0) {
    const parts = [
      toCreate > 0 && plural(toCreate, 'actividad', 'actividades'),
      blocksToCreate > 0 && plural(blocksToCreate, 'bloque', 'bloques'),
      plural(gradesToCreate, 'nota', 'notas'),
    ].filter(Boolean);
    return `${toCreate + blocksToCreate === 0 ? 'Guardar' : 'Crear'} ${parts.join(' y ')}`;
  }
  if (blocksToCreate === 0) return `Crear ${plural(toCreate, 'actividad', 'actividades')}`;
  if (toCreate === 0) return 'Crear horario';
  return `Crear ${plural(toCreate, 'actividad', 'actividades')} y ${plural(blocksToCreate, 'bloque', 'bloques')}`;
}

/** The sentence after a confirmation: what was created and what was already there. */
export function createdMessage(result: {
  count: number;
  createdBlocks: readonly unknown[];
  reusedBlocks: readonly unknown[];
  evaluations?: readonly { action: string }[];
}): string {
  const parts: string[] = [];
  if (result.count > 0) {
    parts.push(result.count === 1 ? '1 actividad creada' : `${result.count} actividades creadas`);
  }
  const grades = result.evaluations ?? [];
  const added = grades.filter((e) => e.action === 'CREATE_EVALUATION').length;
  const saved = grades.length - added;
  if (saved > 0) parts.push(saved === 1 ? '1 nota guardada' : `${saved} notas guardadas`);
  if (added > 0)
    parts.push(added === 1 ? '1 evaluación agregada' : `${added} evaluaciones agregadas`);
  const blocks = result.createdBlocks.length;
  if (blocks > 0) {
    parts.push(
      blocks === 1 ? '1 bloque de horario creado' : `${blocks} bloques de horario creados`,
    );
  }
  const reused = result.reusedBlocks.length;
  if (reused > 0) {
    parts.push(
      reused === 1
        ? '1 bloque ya estaba en tu horario'
        : `${reused} bloques ya estaban en tu horario`,
    );
  }
  return `${parts.join(' y ')}.`;
}

/** The request that creates what is ticked. Only complete ones go: the button never offers more than that. */
export function buildConfirmRequest(state: ReviewState): CaptureConfirmRequest {
  const items: CaptureConfirmRequest['items'] = [];
  const blocks: CaptureConfirmRequest['blocks'] = [];
  const evaluations: NonNullable<CaptureConfirmRequest['evaluations']> = [];
  for (const r of state.recurrences) {
    if (!r.selected || !isRecurrenceComplete(r)) continue;
    const subject = effectiveRecurrenceSubject(r)!;
    for (const slot of effectiveSlots(r)) {
      blocks.push({
        clientId: blockClientId(r.suggestion.clientId, slot.weekday),
        type: r.suggestion.blockType,
        title: effectiveRecurrenceTitle(r).trim(),
        weekday: slot.weekday,
        startTime: slot.start,
        endTime: slot.end,
        subject:
          subject.kind === 'EXISTING'
            ? { kind: 'EXISTING', subjectId: subject.id }
            : subject.kind === 'NEW'
              ? { kind: 'NEW', name: subject.name.trim() }
              : { kind: 'NONE' },
      });
    }
  }
  for (const item of state.items) {
    if (!item.selected || !isComplete(state, item) || agendaBlocked(state, item.proposal.clientId))
      continue;
    const subject = effectiveSubject(state, item)!;
    const time = effectiveTime(state, item);
    const description = effectiveDescription(item).trim();
    items.push({
      clientId: item.proposal.clientId,
      title: effectiveTitle(state, item).trim(),
      type: effectiveType(item),
      dueDate: effectiveDate(item),
      ...(time ? { dueTime: time } : {}),
      ...(description ? { description } : {}),
      subject:
        subject.kind === 'EXISTING'
          ? { kind: 'EXISTING', subjectId: subject.id }
          : subject.kind === 'NEW'
            ? { kind: 'NEW', name: subject.name.trim() }
            : { kind: 'NONE' },
      ...(item.allowDuplicate ? { allowDuplicate: true } : {}),
    });
  }
  for (const g of state.grades) {
    if (!g.selected) continue;
    const request = gradeResolution(g).request;
    if (!request) continue;
    const { activityClientId, ...rest } = request;
    // The link to the activity of the same sentence only holds while that activity is created for the same subject.
    const linked = activityClientId
      ? items.find((i) => i.clientId === activityClientId)
      : undefined;
    const sameSubject =
      linked?.subject.kind === 'EXISTING' && linked.subject.subjectId === request.subjectId;
    evaluations.push({
      clientId: g.suggestion.clientId,
      ...rest,
      ...(sameSubject ? { activityClientId } : {}),
    });
  }
  return evaluations.length > 0 ? { items, blocks, evaluations } : { items, blocks };
}
