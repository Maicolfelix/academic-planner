import { z } from 'zod';
import { periodSchema, type EducationContext } from './academic.js';
import { findProgramByKey, profileSchema, type Profile } from './profile.js';
import { studyTrackSchema } from './studyTrack.js';

/**
 * COMPLETING THE ONBOARDING INTO A STUDY (P0.5-5, D35). When a student who said they study (university, school or something else)
 * finishes the onboarding, the period they already created becomes the first period of a PRIMARY study: it is adopted in place,
 * never copied. A teacher, a personal use or a skipped profile get no study. This module is the ONE place that says what that
 * study is called and what kind it is, so the server (which creates it) and the final screen (which tells the student what will
 * happen) can never disagree.
 */

/** What the server will create, or what the final screen previews. */
export interface OnboardingStudy {
  name: string;
  type: EducationContext;
  /** Set only when the profile's program IS that catalog entry (the canonical name travels with it). */
  programKey: string | null;
}

/** The names given when the student said what they study but not which program. Backed by the explicit choice of `primaryUse`. */
export const DEFAULT_STUDY_NAMES = {
  UNIVERSITY: 'Universidad',
  SCHOOL: 'Colegio',
  OTHER_ACADEMIC: 'Otro estudio',
} as const satisfies Record<EducationContext, string>;

type Program = Pick<Profile, 'programName' | 'programKey'>;

/** The program the student wrote or picked: a catalog one (key + canonical name), a custom one (the name, no key), or none. */
function programOf(profile: Program): { name: string; programKey: string | null } | null {
  const name = profile.programName?.trim();
  if (!name) return null;
  const entry = profile.programKey ? findProgramByKey(profile.programKey) : undefined;
  return entry && entry.name === name
    ? { name: entry.name, programKey: entry.key }
    : { name, programKey: null };
}

/**
 * The study that completing the onboarding creates for this profile, or null when it creates none.
 *  - UNIVERSITY_STUDENT: the program (catalog or their own) or "Universidad";
 *  - OTHER_STUDENT: the program/course (catalog or their own) or "Otro estudio";
 *  - SCHOOL_STUDENT: "Colegio" (the school flow never asks for a program);
 *  - TEACHER, PERSONAL and no answer: none.
 * Nothing here invents an institution, a career, a technical program or a diploma.
 */
export function studyOfOnboarding(
  profile: Pick<Profile, 'primaryUse' | 'programName' | 'programKey'>,
): OnboardingStudy | null {
  switch (profile.primaryUse) {
    case 'UNIVERSITY_STUDENT': {
      const program = programOf(profile);
      return {
        type: 'UNIVERSITY',
        name: program?.name ?? DEFAULT_STUDY_NAMES.UNIVERSITY,
        programKey: program?.programKey ?? null,
      };
    }
    case 'OTHER_STUDENT': {
      const program = programOf(profile);
      return {
        type: 'OTHER_ACADEMIC',
        name: program?.name ?? DEFAULT_STUDY_NAMES.OTHER_ACADEMIC,
        programKey: program?.programKey ?? null,
      };
    }
    case 'SCHOOL_STUDENT':
      return { type: 'SCHOOL', name: DEFAULT_STUDY_NAMES.SCHOOL, programKey: null };
    default:
      return null;
  }
}

/**
 * `POST /api/onboarding/complete` takes NO body (and refuses anything in it): the server derives everything from what the
 * onboarding already confirmed. The answer is additive: the profile as it is now, the study the account has for its home period
 * (the one just created, or the one it already had; null when there is none) and the home period (null only for an account that
 * had finished before and has no home period now).
 */
export const completeOnboardingResponseSchema = z.object({
  profile: profileSchema,
  studyTrack: studyTrackSchema.nullable(),
  period: periodSchema.nullable(),
});
export type CompleteOnboardingResponse = z.infer<typeof completeOnboardingResponseSchema>;
