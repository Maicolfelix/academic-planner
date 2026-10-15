import {
  EDUCATION_CONTEXT_LABELS,
  findProgramByKey,
  type AcademicPeriod,
  type CurrentPeriodContext,
  type EducationContext,
  type Profile,
  type StudyTrack,
  type Subject,
} from '@planner/core';
import { ApiRequestError } from '../api/client';

/**
 * "MIS ESTUDIOS" AS DATA. Pure functions over what the server already says (the studies, the current periods, the subjects, the
 * periods): nothing here is stored and nothing reads a program by name. The words of the screen are the user's ("Estudio",
 * "Tipo de estudio", "Estudio principal", "Periodo actual", "Materias"), never the model's.
 */

/** The human name of the kind of study. */
export const typeLabel = (type: EducationContext): string => EDUCATION_CONTEXT_LABELS[type];

/** "4.º semestre", "Grado 9", "Nivel 3" or the note the student wrote; null when the period has no level. */
export function levelLabel(
  type: EducationContext,
  period: Pick<AcademicPeriod, 'studyLevel' | 'studyLevelNote'>,
): string | null {
  if (period.studyLevelNote !== null) return period.studyLevelNote;
  if (period.studyLevel === null) return null;
  if (type === 'UNIVERSITY') return `${period.studyLevel}.º semestre`;
  if (type === 'SCHOOL') return `Grado ${period.studyLevel}`;
  return `Nivel ${period.studyLevel}`;
}

export const subjectsCountLabel = (n: number): string =>
  n === 0 ? 'Sin materias' : n === 1 ? '1 materia' : `${n} materias`;

export interface StudyCardModel {
  track: StudyTrack;
  /** The study's current period, or null ("Sin periodo actual"). */
  current: AcademicPeriod | null;
  /** The subjects of that current period. */
  subjectCount: number;
}

/** The ACTIVE studies as cards, in the order the API gives them (the primary first). */
export function activeCards(
  tracks: readonly StudyTrack[],
  currents: readonly CurrentPeriodContext[],
  subjects: readonly Pick<Subject, 'periodId'>[],
): StudyCardModel[] {
  return tracks
    .filter((t) => t.status === 'ACTIVE')
    .map((track) => {
      const current = currents.find((c) => c.studyTrack?.id === track.id)?.period ?? null;
      const subjectCount = current ? subjects.filter((s) => s.periodId === current.id).length : 0;
      return { track, current, subjectCount };
    });
}

export const archivedTracks = (tracks: readonly StudyTrack[]): StudyTrack[] =>
  tracks.filter((t) => t.status === 'ARCHIVED');

/** The periods of one study, in the API order (newest first). */
export const periodsOf = (periods: readonly AcademicPeriod[], trackId: string): AcademicPeriod[] =>
  periods.filter((p) => p.studyTrackId === trackId);

/**
 * "Tu planificación actual": the general (no study) period that is current. It is what an account created before the studies
 * existed has. Opening the screen never turns it into anything: the student decides.
 */
export const legacyPlan = (periods: readonly AcademicPeriod[]): AcademicPeriod | null =>
  periods.find((p) => p.isCurrent && p.studyTrackId === null) ?? null;

export interface Suggestion {
  name: string;
  /** Only when the profile's program IS that catalog entry (so the canonical name travels with the key). */
  programKey: string | null;
  /** Null when the profile does not say which kind of study it is: the student chooses. */
  type: EducationContext | null;
}

const TYPE_OF_USE: Partial<Record<NonNullable<Profile['primaryUse']>, EducationContext>> = {
  UNIVERSITY_STUDENT: 'UNIVERSITY',
  SCHOOL_STUDENT: 'SCHOOL',
  OTHER_STUDENT: 'OTHER_ACADEMIC',
};

/**
 * A PROPOSAL for the study that would adopt the legacy plan, from what the profile already says (the program, what they use the
 * app for) and the period's own name. It is only ever shown as a prefilled form: nothing is written until the student confirms
 * it, and they can change every part. A teacher or a personal use gets no type guessed.
 */
export function suggestStudy(
  profile: Pick<Profile, 'programName' | 'programKey' | 'primaryUse'> | null | undefined,
  period: Pick<AcademicPeriod, 'name'>,
): Suggestion {
  const programName = profile?.programName?.trim() || null;
  const key = profile?.programKey ?? null;
  const isCatalogName =
    key !== null && programName !== null && findProgramByKey(key)?.name === programName;
  return {
    name: programName ?? period.name,
    programKey: isCatalogName ? key : null,
    type: profile?.primaryUse ? (TYPE_OF_USE[profile.primaryUse] ?? null) : null,
  };
}

/** What the student reads when a study action fails: the server's own words, except where a code has better ones. */
export function studyErrorText(err: Error): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'PRIMARY_TRACK_REQUIRES_REPLACEMENT') {
      return 'Elige primero otro estudio como principal.';
    }
    if (err.code === 'STUDY_TRACK_ARCHIVED')
      return 'Ese estudio está archivado. Restáuralo primero.';
    if (err.code === 'PERIOD_ALREADY_IN_STUDY') return 'Ese periodo ya pertenece a un estudio.';
  }
  return err.message;
}
