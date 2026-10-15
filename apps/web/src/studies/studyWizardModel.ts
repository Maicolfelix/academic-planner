import type {
  AcademicPeriod,
  EducationContext,
  PrimaryUse,
  SetupStudyTrackRequest,
} from '@planner/core';

/**
 * THE "AGREGAR ESTUDIO" FLOW AS DATA. Six short steps; the last one only confirms, and nothing is written before it. A school
 * study has a name offered ("Colegio") but every part stays editable; dates are never guessed; the level is optional for EVERY
 * kind of study (a technical program, a diploma or a language course may have levels, modules or stages: for "other study" it is
 * a number or a few words, never a "semester"); subjects are optional.
 */
export type WizardStep = 'TYPE' | 'NAME' | 'PERIOD' | 'LEVEL' | 'SUBJECTS' | 'CONFIRM';

/** The same six steps for every kind of study; the level is optional for all of them (its words change, see `levelCopy`). */
export const wizardSteps = (_type: EducationContext | null): WizardStep[] => [
  'TYPE',
  'NAME',
  'PERIOD',
  'LEVEL',
  'SUBJECTS',
  'CONFIRM',
];

export const stepAfter = (step: WizardStep, type: EducationContext | null): WizardStep | null =>
  wizardSteps(type)[wizardSteps(type).indexOf(step) + 1] ?? null;

export const stepBefore = (step: WizardStep, type: EducationContext | null): WizardStep | null =>
  wizardSteps(type)[wizardSteps(type).indexOf(step) - 1] ?? null;

export interface WizardState {
  type: EducationContext | null;
  name: string;
  /** A catalog program (its canonical name travels with the key); null = the name is the student's own. */
  programKey: string | null;
  period: { name: string; startDate: string; endDate: string } | null;
  level: Pick<AcademicPeriod, 'studyLevel' | 'studyLevelNote'>;
  subjects: string[];
}

export const emptyWizard: WizardState = {
  type: null,
  name: '',
  programKey: null,
  period: null,
  level: { studyLevel: null, studyLevelNote: null },
  subjects: [],
};

/** Offered when the kind of study is chosen; the student can change it. Nothing else is ever pre-written. */
export const defaultStudyName = (type: EducationContext): string =>
  type === 'SCHOOL' ? 'Colegio' : '';

/** Only the WORDS of the reused onboarding steps depend on this. */
export const primaryUseOf = (type: EducationContext): PrimaryUse =>
  type === 'UNIVERSITY'
    ? 'UNIVERSITY_STUDENT'
    : type === 'SCHOOL'
      ? 'SCHOOL_STUDENT'
      : 'OTHER_STUDENT';

/** The single request that creates everything. Never an owner, a primary flag, a period id, a context or a color. */
export function toSetupRequest(s: WizardState): SetupStudyTrackRequest {
  if (!s.type || !s.period) throw new Error('The study is not complete.');
  const { studyLevel, studyLevelNote } = s.level;
  return {
    track: s.programKey
      ? { type: s.type, programKey: s.programKey }
      : { type: s.type, name: s.name },
    period: {
      ...s.period,
      ...(studyLevel !== null && { studyLevel }),
      ...(studyLevelNote !== null && { studyLevelNote }),
    },
    ...(s.subjects.length > 0 && { subjects: s.subjects }),
  };
}
