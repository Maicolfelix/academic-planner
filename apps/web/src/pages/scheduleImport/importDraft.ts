import {
  SUBJECT_NAME_MAX,
  findSubjectByName,
  normalizeNameKey,
  type ConfirmScheduleImportRequest,
  type ScheduleImportProposal,
  type Subject,
} from '@planner/core';

/** The value of the subject selector that means "create a new subject with the name typed below". */
export const NEW_SUBJECT = '__new__';

/** What the student can correct before importing. */
export interface ImportDraft {
  /** An existing subject's id, `NEW_SUBJECT`, or '' while the student still has to decide. */
  subjectId: string;
  /** The name of the subject to create (only read when `subjectId` is `NEW_SUBJECT`). */
  newName: string;
  /** '1'-'7' or '' when it could not be read. */
  weekday: string;
  startTime: string;
  endTime: string;
  title: string;
  /** Last day of the weekly repetition. */
  until: string;
}

export interface Conflict {
  title: string;
  startAt: string;
  endAt: string;
}

export interface ImportRow {
  proposal: ScheduleImportProposal;
  draft: ImportDraft;
  selected: boolean;
  /** The title still follows the subject name (the student has not typed their own). */
  autoTitle: boolean;
  /** `error`: the server refused this class (nothing was saved); `created`: it was saved with the rest. */
  status: 'idle' | 'creating' | 'created' | 'error';
  error?: string;
  errors: Record<string, string[]>;
  /** Conflicts found while editing (the Schedule service in dry-run mode); null = the ones from the reading. */
  liveConflicts: Conflict[] | null;
}

/** Whether this class asks for a new subject. */
export const isNewSubject = (d: ImportDraft) => d.subjectId === NEW_SUBJECT;

/** The trouble with the name of a new subject, or undefined when it is fine. */
export function newNameProblem(d: ImportDraft): string | undefined {
  if (!isNewSubject(d)) return undefined;
  const name = d.newName.trim();
  if (name === '') return 'Ingresa un nombre.';
  if (name.length > SUBJECT_NAME_MAX)
    return `El nombre es demasiado largo (máximo ${SUBJECT_NAME_MAX} caracteres).`;
  return undefined;
}

/** What is still missing or wrong for this class to be created. */
export function problemsOf(d: ImportDraft): string[] {
  const out: string[] = [];
  if (d.subjectId === '') out.push('la asignatura');
  else if (newNameProblem(d)) out.push('el nombre de la asignatura');
  if (d.weekday === '') out.push('el día');
  if (d.startTime === '') out.push('la hora de inicio');
  if (d.endTime === '') out.push('la hora de fin');
  if (d.title.trim() === '') out.push('el título');
  return out;
}

export const endsBeforeStart = (d: ImportDraft) =>
  d.startTime !== '' && d.endTime !== '' && d.endTime <= d.startTime;

/** The card field a zod or server field key (`subject.name`, `until`…) belongs to. */
export function cardField(key: string): string {
  if (key === 'subject.name') return 'newName';
  if (key === 'subject' || key.startsWith('subject.')) return 'subjectId';
  if (key === 'until') return 'recurrence';
  if (key === 'weekday') return 'date';
  return key;
}

/** The server's field errors of one class, keyed by what the card shows. */
export function cardErrors(fields: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fields))
    (out[cardField(key)] ??= []).push(...messages);
  return out;
}

/** One class as the confirmation endpoint takes it. The card index is the client id: it never leaves the page. */
export function toConfirmClass(
  d: ImportDraft,
  clientId: string,
): ConfirmScheduleImportRequest['classes'][number] {
  return {
    clientId,
    weekday: Number(d.weekday),
    startTime: d.startTime,
    endTime: d.endTime,
    title: d.title,
    until: d.until,
    subject: isNewSubject(d)
      ? { kind: 'NEW', name: d.newName }
      : { kind: 'EXISTING', subjectId: d.subjectId },
  };
}

/**
 * The subjects that confirming these classes would create, once per name (the same normalisation the server uses): a
 * name that is already one of the student's subjects creates nothing.
 */
export function subjectsToCreate(drafts: readonly ImportDraft[], subjects: readonly Subject[]) {
  const seen = new Map<string, string>();
  for (const d of drafts) {
    if (!isNewSubject(d) || newNameProblem(d)) continue;
    const key = normalizeNameKey(d.newName);
    if (!seen.has(key) && !findSubjectByName(d.newName, subjects)) seen.set(key, d.newName.trim());
  }
  return [...seen.values()];
}
