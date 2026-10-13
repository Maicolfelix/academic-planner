import { primaryUseToEducationContext, type EducationContext } from '@planner/core';
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
 *  - an explicit context (even `null`) wins;
 *  - otherwise the default is derived from the profile's primary use (`primaryUseToEducationContext`): a DEFAULT for NEW
 *    subjects only, never applied to the ones that already exist, and `null` when the profile has no primary use;
 *  - the profile is READ, never created or repaired here: a user without one is the existing invariant failure.
 * It never looks at a subject's name. The default is read from the profile on every call unless `readOnce` is set, which is
 * only for an instance that lives and dies with ONE transaction (so many subjects of one request cost one read); a
 * long-lived instance must NOT cache it, or a later change of the primary use would never be seen.
 */
export function createSubjectMaterializer(
  subjects: SubjectRepository,
  profiles: ProfileRepository,
  opts: { readOnce?: boolean } = {},
) {
  const defaults = new Map<string, EducationContext | null>();

  async function defaultContext(userId: string): Promise<EducationContext | null> {
    if (opts.readOnce && defaults.has(userId)) return defaults.get(userId)!;
    const profile = await profiles.find(userId);
    if (!profile) throw profileInvariantBroken();
    const context = primaryUseToEducationContext(profile.primaryUse);
    if (opts.readOnce) defaults.set(userId, context);
    return context;
  }

  const contextFor = async (userId: string, explicit?: EducationContext | null) =>
    explicit !== undefined ? explicit : defaultContext(userId);

  return {
    contextFor,

    /** Creates the subject unless the period already has that name key (see `SubjectRepository.createIfAbsent`). */
    async createIfAbsent(data: NewSubject) {
      const educationContext = await contextFor(data.userId, data.educationContext);
      return subjects.createIfAbsent({ ...data, educationContext });
    },
  };
}

export type SubjectMaterializer = ReturnType<typeof createSubjectMaterializer>;
