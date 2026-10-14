import { primaryUseToEducationContext, type EducationContext } from '@planner/core';
import type { PeriodLookup } from '../repositories/periodRepository.js';
import type { ProfileRepository } from '../repositories/profileRepository.js';
import type { SubjectCreateData, SubjectRepository } from '../repositories/subjectRepository.js';
import { profileInvariantBroken } from './profileService.js';

type NewSubject = Omit<SubjectCreateData, 'educationContext'> & {
  /** A value (or `null`: "not specified") is used as given; undefined = the default of the user's primary use. */
  educationContext?: EducationContext | null;
};

/**
 * THE one place that decides the education context of a subject that is about to exist, so the manual form, Smart Capture,
 * the Academic Inbox, the schedule import and the quick batch all follow the same rule and none of them implements its own:
 *  1. an explicit context (even `null`) wins;
 *  2. otherwise, if the PERIOD the subject is created in belongs to a study, the TYPE of that study (the study is the
 *     authority; the period is how a subject reaches it: no client-sent study id, never the study's name or program key);
 *  3. otherwise (a general period) the default derived from the profile's primary use (`primaryUseToEducationContext`), and
 *     `null` when the profile has no primary use.
 * Every one of them is a DEFAULT for NEW subjects only, never applied to the ones that already exist (so editing a study's
 * type changes later subjects, never earlier ones). The profile is READ, never created or repaired here: a user without one is
 * the existing invariant failure. It never looks at a subject's name. What is read (the study type of a period, the profile)
 * is read on every call unless `readOnce` is set, which is only for an instance that lives and dies with ONE transaction (so
 * many subjects of one request cost one read); a long-lived instance must NOT cache it, or a later change would never be seen.
 */
export function createSubjectMaterializer(
  subjects: SubjectRepository,
  profiles: ProfileRepository,
  periods: Pick<PeriodLookup, 'studyTrackTypeOf'>,
  opts: { readOnce?: boolean } = {},
) {
  const defaults = new Map<string, EducationContext | null>();
  const studyTypes = new Map<string, EducationContext | null>();

  async function studyTypeOf(userId: string, periodId: string): Promise<EducationContext | null> {
    if (opts.readOnce && studyTypes.has(periodId)) return studyTypes.get(periodId)!;
    const type = await periods.studyTrackTypeOf(userId, periodId);
    if (opts.readOnce) studyTypes.set(periodId, type);
    return type;
  }

  async function defaultContext(userId: string): Promise<EducationContext | null> {
    if (opts.readOnce && defaults.has(userId)) return defaults.get(userId)!;
    const profile = await profiles.find(userId);
    if (!profile) throw profileInvariantBroken();
    const context = primaryUseToEducationContext(profile.primaryUse);
    if (opts.readOnce) defaults.set(userId, context);
    return context;
  }

  const contextFor = async (
    userId: string,
    explicit: EducationContext | null | undefined,
    periodId: string,
  ) => {
    if (explicit !== undefined) return explicit;
    return (await studyTypeOf(userId, periodId)) ?? defaultContext(userId);
  };

  return {
    contextFor,

    /** Creates the subject unless the period already has that name key (see `SubjectRepository.createIfAbsent`). */
    async createIfAbsent(data: NewSubject) {
      const educationContext = await contextFor(data.userId, data.educationContext, data.periodId);
      return subjects.createIfAbsent({ ...data, educationContext });
    },
  };
}

export type SubjectMaterializer = ReturnType<typeof createSubjectMaterializer>;
