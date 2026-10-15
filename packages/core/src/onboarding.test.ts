import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDY_NAMES,
  completeOnboardingResponseSchema,
  createStudyTrackSchema,
  studyOfOnboarding,
} from './index.js';

const profile = (over: object = {}) => ({
  primaryUse: 'UNIVERSITY_STUDENT' as const,
  programName: null,
  programKey: null,
  ...over,
});

describe('the study that completing the onboarding creates', () => {
  it('a university student: the catalog program (key + canonical name), their own program, or "Universidad"', () => {
    expect(studyOfOnboarding(profile({ programName: 'Medicina', programKey: 'medicina' }))).toEqual(
      {
        name: 'Medicina',
        type: 'UNIVERSITY',
        programKey: 'medicina',
      },
    );
    expect(studyOfOnboarding(profile({ programName: '  Mi carrera  ' }))).toEqual({
      name: 'Mi carrera',
      type: 'UNIVERSITY',
      programKey: null,
    });
    expect(studyOfOnboarding(profile())).toEqual({
      name: 'Universidad',
      type: 'UNIVERSITY',
      programKey: null,
    });
    // a key that does not match its name is not trusted: the name is the authority, with no key
    expect(studyOfOnboarding(profile({ programName: 'Derecho', programKey: 'medicina' }))).toEqual({
      name: 'Derecho',
      type: 'UNIVERSITY',
      programKey: null,
    });
    // blank text is "no program"
    expect(studyOfOnboarding(profile({ programName: '   ' }))?.name).toBe('Universidad');
  });

  it('a school student: "Colegio", whatever program was typed before (the school flow never asks for one)', () => {
    expect(studyOfOnboarding(profile({ primaryUse: 'SCHOOL_STUDENT' }))).toEqual({
      name: 'Colegio',
      type: 'SCHOOL',
      programKey: null,
    });
    expect(
      studyOfOnboarding(
        profile({ primaryUse: 'SCHOOL_STUDENT', programName: 'Medicina', programKey: 'medicina' }),
      )?.name,
    ).toBe('Colegio');
  });

  it('another study: the program or course they named, or "Otro estudio"', () => {
    expect(
      studyOfOnboarding(profile({ primaryUse: 'OTHER_STUDENT', programName: 'Inglés B2' })),
    ).toEqual({
      name: 'Inglés B2',
      type: 'OTHER_ACADEMIC',
      programKey: null,
    });
    expect(studyOfOnboarding(profile({ primaryUse: 'OTHER_STUDENT' }))).toEqual({
      name: 'Otro estudio',
      type: 'OTHER_ACADEMIC',
      programKey: null,
    });
  });

  it('a teacher, a personal use and no answer get NO study', () => {
    for (const primaryUse of ['TEACHER', 'PERSONAL', null] as const) {
      expect(
        studyOfOnboarding(profile({ primaryUse, programName: 'Medicina', programKey: 'medicina' })),
      ).toBeNull();
    }
  });

  it('whatever it derives is a valid new study (the same rules as Mis estudios), and the names are the documented ones', () => {
    expect(DEFAULT_STUDY_NAMES).toEqual({
      UNIVERSITY: 'Universidad',
      SCHOOL: 'Colegio',
      OTHER_ACADEMIC: 'Otro estudio',
    });
    for (const p of [
      profile(),
      profile({ programName: 'Medicina', programKey: 'medicina' }),
      profile({ primaryUse: 'SCHOOL_STUDENT' }),
      profile({ primaryUse: 'OTHER_STUDENT', programName: 'x'.repeat(80) }),
    ]) {
      const study = studyOfOnboarding(p)!;
      const input = study.programKey
        ? { type: study.type, programKey: study.programKey }
        : { type: study.type, name: study.name };
      expect(createStudyTrackSchema.safeParse(input).success).toBe(true);
    }
  });
});

describe('completeOnboardingResponseSchema', () => {
  it('takes a profile, a study (or null) and the period (or null), and nothing with an owner', () => {
    const iso = '2026-10-01T00:00:00.000Z';
    const period = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'P',
      startDate: '2026-08-03',
      endDate: '2026-11-28',
      isCurrent: true,
      studyTrackId: null,
      studyLevel: null,
      studyLevelNote: null,
      createdAt: iso,
      updatedAt: iso,
    };
    const base = {
      profile: {
        primaryUse: 'TEACHER',
        programName: null,
        programKey: null,
        onboardingStatus: 'COMPLETED',
      },
      studyTrack: null,
      period,
    };
    expect(completeOnboardingResponseSchema.safeParse(base).success).toBe(true);
    expect(completeOnboardingResponseSchema.safeParse({ ...base, period: null }).success).toBe(
      true,
    );
    expect(
      completeOnboardingResponseSchema.safeParse({ ...base, profile: undefined }).success,
    ).toBe(false);
  });
});
