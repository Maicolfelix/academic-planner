import type { PrimaryUse, Profile } from '@planner/core';
import { suggestPeriodName } from '../lib/periodName';

/**
 * WHERE the onboarding is, derived from what the SERVER already knows (no step counter is stored): the first thing that is
 * still missing.
 *  - USE: the primary use is not answered (and the student did not skip it);
 *  - PERIOD: the app needs a current period and there is none;
 *  - DONE: nothing is missing.
 * A student who skipped the question and has no period goes straight to the period (it is mandatory: activities, subjects
 * and the agenda all hang from it). One who skipped but already HAS a period and opens the onboarding by hand sees the
 * question again: skipping never forbids coming back.
 */
export type OnboardingStep = 'USE' | 'PERIOD' | 'DONE';

export function onboardingStep(
  profile: Pick<Profile, 'primaryUse' | 'onboardingStatus'>,
  hasCurrentPeriod: boolean,
): OnboardingStep {
  if (hasCurrentPeriod) return profile.primaryUse === null ? 'USE' : 'DONE';
  if (profile.primaryUse !== null || profile.onboardingStatus === 'SKIPPED') return 'PERIOD';
  return 'USE';
}

export type UseIcon = 'book' | 'check' | 'user' | 'spark' | 'calendar';

export interface UseOption {
  value: PrimaryUse;
  title: string;
  description: string;
  icon: UseIcon;
}

/** In the order they are offered. */
export const USE_OPTIONS: readonly UseOption[] = [
  {
    value: 'UNIVERSITY_STUDENT',
    title: 'Universidad',
    description: 'Semestres, materias, parciales y entregas.',
    icon: 'book',
  },
  {
    value: 'SCHOOL_STUDENT',
    title: 'Colegio',
    description: 'Materias, tareas y evaluaciones del año escolar.',
    icon: 'check',
  },
  {
    value: 'TEACHER',
    title: 'Soy docente',
    description: 'Tus clases, entregas y pendientes en un solo lugar.',
    icon: 'user',
  },
  {
    value: 'OTHER_STUDENT',
    title: 'Otro tipo de estudio',
    description: 'Un curso, idiomas, un programa técnico o estudiar por tu cuenta.',
    icon: 'spark',
  },
  {
    value: 'PERSONAL',
    title: 'Organización personal',
    description: 'Tareas, agenda y recordatorios para tu día a día.',
    icon: 'calendar',
  },
];

/** Only the WORDS change with the primary use; the period is the same thing for everybody. */
export function periodHeading(primaryUse: PrimaryUse | null): string {
  switch (primaryUse) {
    case 'UNIVERSITY_STUDENT':
      return 'Tu semestre actual';
    case 'SCHOOL_STUDENT':
      return 'Tu periodo escolar';
    case 'OTHER_STUDENT':
      return 'Tu periodo de estudio';
    case 'PERSONAL':
      return 'Tu planificación actual';
    default:
      return 'Tu periodo actual'; // a teacher, or no answer
  }
}

/** The name offered for the period (the student can change it). Dates are never guessed. */
export function defaultPeriodName(primaryUse: PrimaryUse | null, today: Date = new Date()): string {
  return primaryUse === 'PERSONAL' ? 'Mi planificación' : suggestPeriodName(today);
}
