import type {
  ConfirmIcsImportRequest,
  IcsParseResponse,
  IcsProposal,
  IcsSubjectChoice,
} from '@planner/core';

/**
 * The review of a .ics as plain data and pure functions (no React, no network). The engine proposed; the student decides what each
 * event is (activity, class or nothing), its title, its subject and what the file leaves open. Nothing is created before the
 * confirmation, which creates everything ticked or nothing.
 */

export type RowKind = 'ACTIVITY' | 'BLOCK' | 'SKIP';
/** What to do with a repeating class that has calendar exceptions (EXDATE): never ignored silently. */
export type ExceptionChoice = 'UNDECIDED' | 'SERIES' | 'SINGLE' | 'SKIP';

/**
 * The subject decision, explicit: UNRESOLVED = "not chosen yet" (an ambiguous name waiting for an answer, or a class without one),
 * NONE = "import it without a subject" (an activity only), SUBJECT = `subjectId`. An empty string never means two things.
 */
export type SubjectChoice = 'UNRESOLVED' | 'NONE' | 'SUBJECT';
/** The value of the "import without a subject" option in the subject select. */
export const NO_SUBJECT = '__none';

export interface ReviewRow {
  proposal: IcsProposal;
  selected: boolean;
  kind: RowKind;
  title: string;
  subjectChoice: SubjectChoice;
  /** The chosen subject when `subjectChoice` is SUBJECT, else ''. */
  subjectId: string;
  /** 'HH:mm' or ''. */
  endTime: string;
  exceptionChoice: ExceptionChoice;
  /** The server refused this one (a message from the last confirmation). */
  error?: string;
}

const initialKind = (p: IcsProposal): RowKind =>
  p.kindProposal === 'ACTIVITY'
    ? 'ACTIVITY'
    : p.kindProposal === 'SCHEDULE_BLOCK'
      ? 'BLOCK'
      : 'SKIP';

export function createRows(result: Pick<IcsParseResponse, 'proposals'>): ReviewRow[] {
  return result.proposals.map((proposal) => ({
    proposal,
    selected: proposal.selected && proposal.kindProposal !== 'UNSUPPORTED',
    kind: initialKind(proposal),
    title: proposal.title,
    subjectChoice:
      proposal.subject.kind === 'EXISTING'
        ? 'SUBJECT'
        : proposal.subject.kind === 'AMBIGUOUS'
          ? 'UNRESOLVED'
          : proposal.kindProposal === 'ACTIVITY'
            ? 'NONE'
            : 'UNRESOLVED',
    subjectId: proposal.subject.kind === 'EXISTING' ? proposal.subject.id : '',
    endTime: proposal.endTime ?? '',
    exceptionChoice:
      proposal.exceptions > 0 && proposal.repeats === 'WEEKLY' ? 'UNDECIDED' : 'SERIES',
  }));
}

/** Only the subjects the engine said it could be (an ambiguous event offers just those); else all the student's current ones. */
export function subjectOptions(
  row: ReviewRow,
  all: readonly IcsSubjectChoice[],
): IcsSubjectChoice[] {
  const s = row.proposal.subject;
  if (s.kind === 'AMBIGUOUS') {
    const ids = new Set(s.candidates.map((c) => c.id));
    return all.filter((c) => ids.has(c.id));
  }
  return [...all];
}

/** Whether the row is a repeating class on the screen (the student may have changed it to a single block or an activity). */
export const isWeekly = (row: ReviewRow) =>
  row.kind === 'BLOCK' && row.proposal.repeats === 'WEEKLY' && row.exceptionChoice !== 'SINGLE';

/** What the student still has to settle on this row before it can be created. */
export function pendingOf(
  row: ReviewRow,
): ('title' | 'subject' | 'endTime' | 'exceptions' | 'time')[] {
  if (row.kind === 'SKIP') return [];
  const out: ReturnType<typeof pendingOf> = [];
  if (row.title.trim() === '') out.push('title');
  if (row.kind === 'BLOCK') {
    if (row.subjectChoice !== 'SUBJECT') out.push('subject');
    if (row.proposal.startTime === null) out.push('time');
    if (row.endTime === '' || (row.proposal.startTime && row.endTime <= row.proposal.startTime))
      out.push('endTime');
    if (
      row.proposal.exceptions > 0 &&
      row.proposal.repeats === 'WEEKLY' &&
      row.exceptionChoice === 'UNDECIDED'
    )
      out.push('exceptions');
  } else if (row.subjectChoice === 'UNRESOLVED') {
    out.push('subject');
  }
  return out;
}

/** "Don't import" through the exception question is the same as unticking. */
export const isReady = (row: ReviewRow) =>
  row.selected &&
  row.kind !== 'SKIP' &&
  row.exceptionChoice !== 'SKIP' &&
  pendingOf(row).length === 0;

export interface IcsReviewSummary {
  toCreate: number;
  activities: number;
  blocks: number;
  /** Ticked but still missing something: the button waits. */
  incomplete: number;
}

export function summarize(rows: readonly ReviewRow[]): IcsReviewSummary {
  const active = rows.filter(
    (r) => r.selected && r.kind !== 'SKIP' && r.exceptionChoice !== 'SKIP',
  );
  const ready = active.filter((r) => pendingOf(r).length === 0);
  return {
    toCreate: ready.length,
    activities: ready.filter((r) => r.kind === 'ACTIVITY').length,
    blocks: ready.filter((r) => r.kind === 'BLOCK').length,
    incomplete: active.length - ready.length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function confirmLabel(s: IcsReviewSummary, busy = false): string {
  if (busy) return 'Importando…';
  if (s.incomplete > 0) return 'Resolver antes de importar';
  if (s.toCreate === 0) return 'Nada que importar';
  const parts = [
    s.activities > 0 && plural(s.activities, 'actividad', 'actividades'),
    s.blocks > 0 && plural(s.blocks, 'clase', 'clases'),
  ].filter(Boolean);
  return `Importar ${parts.join(' y ')}`;
}

/** Everything ticked is resolved and there is something to create: all or nothing, never a silent subset. */
export const canConfirm = (rows: readonly ReviewRow[]) => {
  const s = summarize(rows);
  return s.incomplete === 0 && s.toCreate > 0;
};

/**
 * The request for EVERYTHING ticked, or null when any ticked row is still unresolved (or nothing is ticked): the builder never
 * drops an unfinished row to send the rest. Only data the server cannot derive; the server re-checks every id.
 */
export function buildConfirmRequest(rows: readonly ReviewRow[]): ConfirmIcsImportRequest | null {
  if (!canConfirm(rows)) return null;
  return {
    items: rows.filter(isReady).map((r) => {
      const p = r.proposal;
      const common = {
        clientId: p.clientId,
        title: r.title.trim(),
        subjectId: r.subjectChoice === 'SUBJECT' ? r.subjectId : null,
        date: p.date!,
      };
      if (r.kind === 'ACTIVITY') {
        return {
          ...common,
          kind: 'ACTIVITY' as const,
          startTime: p.startTime,
          type: p.type,
          ...(p.description ? { description: p.description } : {}),
        };
      }
      const weekly = isWeekly(r);
      return {
        ...common,
        kind: 'BLOCK' as const,
        startTime: p.startTime,
        endTime: r.endTime,
        weekly,
        // "Import only the first class" keeps no repetition; a series with exceptions keeps its end as the file says.
        ...(weekly && p.until ? { until: p.until } : {}),
      };
    }),
  };
}

export const setKind = (rows: readonly ReviewRow[], clientId: string, kind: RowKind): ReviewRow[] =>
  rows.map((r) => {
    if (r.proposal.clientId !== clientId) return r;
    // A class needs a subject, an activity does not: a class nobody matched becomes "without subject" when turned into an
    // activity (only a genuinely ambiguous name keeps asking).
    const subjectChoice =
      kind === 'ACTIVITY' &&
      r.subjectChoice === 'UNRESOLVED' &&
      r.proposal.subject.kind !== 'AMBIGUOUS'
        ? 'NONE'
        : r.subjectChoice;
    return { ...r, kind, subjectChoice, error: undefined, selected: kind !== 'SKIP' };
  });

export const patchRow = (
  rows: readonly ReviewRow[],
  clientId: string,
  patch: Partial<ReviewRow>,
): ReviewRow[] =>
  rows.map((r) => (r.proposal.clientId === clientId ? { ...r, error: undefined, ...patch } : r));

export const setErrors = (
  rows: readonly ReviewRow[],
  errors: Record<string, string>,
): ReviewRow[] => rows.map((r) => ({ ...r, error: errors[r.proposal.clientId] }));

/** After a confirmation the created rows leave the review. */
export const removeRows = (rows: readonly ReviewRow[], ids: ReadonlySet<string>): ReviewRow[] =>
  rows.filter((r) => !ids.has(r.proposal.clientId));

export function createdMessage(r: { activities: number; blocks: number; reused: number }): string {
  const parts = [
    r.activities > 0 && plural(r.activities, 'actividad creada', 'actividades creadas'),
    r.blocks > 0 && plural(r.blocks, 'clase creada', 'clases creadas'),
    r.reused > 0 &&
      (r.reused === 1
        ? '1 clase ya estaba en tu horario'
        : `${r.reused} clases ya estaban en tu horario`),
  ].filter(Boolean);
  return `${parts.join(' y ')}.`;
}

/** What choosing an option of the subject select does to the row. Choosing anything but "not yet" also ticks the row. */
export function subjectPatch(value: string): Pick<ReviewRow, 'subjectChoice' | 'subjectId'> & {
  selected?: true;
} {
  if (value === '') return { subjectChoice: 'UNRESOLVED', subjectId: '' };
  if (value === NO_SUBJECT) return { subjectChoice: 'NONE', subjectId: '', selected: true };
  return { subjectChoice: 'SUBJECT', subjectId: value, selected: true };
}

/** The select's value for a row: a class has no "none", so a NONE left from an activity shows as "choose one". */
export const subjectValue = (row: ReviewRow) =>
  row.subjectChoice === 'SUBJECT'
    ? row.subjectId
    : row.subjectChoice === 'NONE' && row.kind === 'ACTIVITY'
      ? NO_SUBJECT
      : '';
