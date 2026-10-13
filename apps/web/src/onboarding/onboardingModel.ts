import {
  SUBJECT_BATCH_MAX,
  SUBJECT_NAME_MAX,
  hasNoNul,
  normalizeNameKey,
  type AcademicPeriod,
  type PrimaryUse,
  type Profile,
} from '@planner/core';
import { z } from 'zod';
import { suggestPeriodName } from '../lib/periodName';

/**
 * THE ONBOARDING AS DATA: which step comes next, derived from what the SERVER already knows (the profile, the current
 * period) plus the few things the student decided in this wizard and the server has no field for (a skipped optional step).
 * No step counter is stored anywhere.
 *
 *  - USE and PERIOD come first and are the only required things: the period because the whole app hangs from it;
 *  - then the OPTIONAL steps that make sense for what the student said they use the app for (see `flowFor`);
 *  - FINAL: "listo para empezar" (two ways out);
 *  - DONE: the wizard was completed (`COMPLETED`), so there is nothing to chase: COMPLETED means "I finished the wizard",
 *    never "every optional field has a value".
 * An optional step is asked until the student answers it or skips it ("decided"); a decision is kept in the wizard's local
 * draft (never a flag on the profile), so reloading does not ask a skipped question again.
 */
export type RequiredStep = 'USE' | 'PERIOD';
export type OptionalStep = 'PROGRAM' | 'LEVEL' | 'SUBJECTS';
export type OnboardingStep = RequiredStep | OptionalStep | 'FINAL' | 'DONE';

/** The optional steps of each use, in order. A personal use has none; no answer has none. */
export function flowFor(primaryUse: PrimaryUse | null): OptionalStep[] {
  switch (primaryUse) {
    case 'UNIVERSITY_STUDENT':
      return ['PROGRAM', 'LEVEL', 'SUBJECTS'];
    case 'SCHOOL_STUDENT':
      return ['LEVEL', 'SUBJECTS'];
    // A level for "other study" would be a question without a clear meaning: it is left out on purpose (see D30).
    case 'OTHER_STUDENT':
      return ['PROGRAM', 'SUBJECTS'];
    case 'TEACHER':
      return ['SUBJECTS'];
    default:
      return [];
  }
}

export interface OnboardingFacts {
  profile: Pick<Profile, 'primaryUse' | 'programName' | 'onboardingStatus'>;
  /** The CURRENT period, or null when there is none. */
  period: Pick<AcademicPeriod, 'studyLevel' | 'studyLevelNote'> | null;
  /** The steps the student answered or skipped in this wizard (kept in the local draft). */
  decided: ReadonlySet<string>;
}

/** Is this optional step settled: answered (the server has it) or skipped/confirmed by the student? */
function settled(step: OptionalStep, f: OnboardingFacts): boolean {
  if (f.decided.has(step)) return true;
  if (step === 'PROGRAM') return f.profile.programName !== null;
  if (step === 'LEVEL')
    return f.period !== null && (f.period.studyLevel !== null || f.period.studyLevelNote !== null);
  return false; // SUBJECTS: asked once (the existing subjects are shown, never retyped)
}

export function onboardingStep(f: OnboardingFacts): OnboardingStep {
  const { profile, period } = f;
  // The wizard was finished: nothing optional is chased, whatever is still empty.
  if (period && profile.onboardingStatus === 'COMPLETED') return 'DONE';
  // Skipped before: for good when there is no period yet (the period is the only thing left); in this session when decided.
  const skippedUse = f.decided.has('USE') || (!period && profile.onboardingStatus === 'SKIPPED');
  if (profile.primaryUse === null && !skippedUse) return 'USE';
  if (!period) return 'PERIOD';
  for (const step of flowFor(profile.primaryUse)) if (!settled(step, f)) return step;
  return 'FINAL';
}

/** The step "Atrás" goes to (the answers stay where the server keeps them), or null on the first one. */
export function previousStep(step: OnboardingStep, f: OnboardingFacts): OnboardingStep | null {
  const flow = flowFor(f.profile.primaryUse);
  const order: OnboardingStep[] = [
    'USE',
    ...(f.period ? [] : (['PERIOD'] as const)),
    ...flow,
    'FINAL',
  ];
  const at = order.indexOf(step);
  return at > 0 ? order[at - 1]! : null;
}

export const STEP_LABEL: Record<RequiredStep | OptionalStep | 'FINAL', string> = {
  USE: 'Perfil',
  PERIOD: 'Periodo',
  PROGRAM: 'Programa',
  LEVEL: 'Nivel',
  SUBJECTS: 'Materias',
  FINAL: 'Listo',
};

/** The steps worth showing in the quiet progress marks for this student (only the ones that exist for them). */
export function progressSteps(primaryUse: PrimaryUse | null): (keyof typeof STEP_LABEL)[] {
  return ['USE', 'PERIOD', ...flowFor(primaryUse), 'FINAL'];
}

// ───────────────────────── Step 1 and 2 (P0-4a) ─────────────────────────

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

// ───────────────────────── Program, level and subjects (P0-4b) ─────────────────────────

export interface ProgramCopy {
  title: string;
  label: string;
  placeholder: string;
}

/** The program question: a university student searches a catalog; any other study mostly writes it. Words only. */
export function programCopy(primaryUse: PrimaryUse | null): ProgramCopy {
  return primaryUse === 'OTHER_STUDENT'
    ? {
        title: '¿Qué estás estudiando?',
        label: 'Curso o programa',
        placeholder: 'Curso de inglés, técnico en…, bootcamp…',
      }
    : {
        title: '¿Qué estudias?',
        label: 'Carrera o programa',
        placeholder: 'Medicina, Derecho, Ingeniería…',
      };
}

export interface LevelCopy {
  title: string;
  /** The words for one option ("Semestre 4"). */
  noun: string;
  /** How many quick options are offered; more is "Otro". The domain accepts 1..99 or a note. */
  options: number;
}

export function levelCopy(primaryUse: PrimaryUse | null): LevelCopy {
  return primaryUse === 'SCHOOL_STUDENT'
    ? { title: '¿En qué grado estás?', noun: 'Grado', options: 11 }
    : { title: '¿En qué semestre estás?', noun: 'Semestre', options: 10 };
}

export function subjectsTitle(primaryUse: PrimaryUse | null): string {
  switch (primaryUse) {
    case 'UNIVERSITY_STUDENT':
      return '¿Qué materias estás cursando?';
    case 'SCHOOL_STUDENT':
      return '¿Qué materias ves?';
    case 'OTHER_STUDENT':
      return '¿Qué materias o módulos tienes?';
    case 'TEACHER':
      return '¿Qué materias o cursos impartes?';
    default:
      return '¿Qué materias tienes este periodo?';
  }
}

export const SUBJECT_CHIPS_MAX = SUBJECT_BATCH_MAX;

export interface AddChipResult {
  chips: string[];
  /** Said next to the field when the name was not added. */
  error?: string;
}

/**
 * Adds a typed name to the list of subjects still to be created: trimmed, never a duplicate (by `normalizeNameKey`: "Farmacología"
 * and " farmacologia " are one), never one the period already has, never past the batch limit. Pure: the field shows the error.
 */
export function addChip(
  chips: readonly string[],
  existing: readonly string[],
  raw: string,
): AddChipResult {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') return { chips: [...chips] };
  if (!hasNoNul(name))
    return { chips: [...chips], error: 'El nombre tiene caracteres no válidos.' };
  if (name.length > SUBJECT_NAME_MAX) {
    return {
      chips: [...chips],
      error: `El nombre es demasiado largo (máximo ${SUBJECT_NAME_MAX} caracteres).`,
    };
  }
  const key = normalizeNameKey(name);
  if (existing.some((e) => normalizeNameKey(e) === key)) {
    return { chips: [...chips], error: 'Ya tienes esa materia en este periodo.' };
  }
  if (chips.some((c) => normalizeNameKey(c) === key)) {
    return { chips: [...chips], error: 'Ya la agregaste.' };
  }
  if (chips.length >= SUBJECT_CHIPS_MAX) {
    return { chips: [...chips], error: `Máximo ${SUBJECT_CHIPS_MAX} materias a la vez.` };
  }
  return { chips: [...chips, name] };
}

export const removeChip = (chips: readonly string[], name: string): string[] =>
  chips.filter((c) => c !== name);

// ───────────────────────── The wizard's local draft ─────────────────────────

export const ONBOARDING_DRAFT_SCOPE = 'onboarding';

/** What the wizard keeps in this browser: the steps decided and the subject names not yet created. Nothing of the profile. */
export const onboardingDraftSchema = z.object({
  decided: z.array(z.enum(['USE', 'PERIOD', 'PROGRAM', 'LEVEL', 'SUBJECTS'])).max(8),
  subjects: z.array(z.string().max(SUBJECT_NAME_MAX)).max(SUBJECT_CHIPS_MAX),
});
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;
