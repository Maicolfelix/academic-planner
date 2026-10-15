import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The program (career) DESCRIBES the user; it never changes what the product does. No source file may branch on a particular
 * program or compare `programKey` with a literal, and `primaryUse` is never read to authorize anything.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DIRS = ['apps/api/src', 'apps/web/src', 'packages/core/src'];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory())
      return e.name === 'generated' || e.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const files = DIRS.flatMap((d) => sources(path.join(ROOT, d)));
const read = (f: string) => fs.readFileSync(f, 'utf8');
/** `typeof x === 'string'` is a type check, not a comparison with a program. */
const withoutTypeChecks = (code: string) =>
  code
    .replaceAll(/\/\*[\s\S]*?\*\//g, '') // comments may quote the very pattern they forbid
    .replaceAll(/^\s*\/\/.*$/gm, '')
    .replaceAll(/typeof\s+[\w.?]+\s*[!=]==?\s*['"`]\w+['"`]/g, '');

describe('no behaviour depends on a particular program or on the primary use', () => {
  it('scans the real sources (a guard against scanning nothing)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('nothing compares a programKey or programName with a literal', () => {
    const offenders = files.filter((f) =>
      /program(Key|Name)\s*[!=]==?\s*['"`]|['"`]\s*[!=]==?\s*[\w.?]*program(Key|Name)\b|case\s+['"`](medicina|derecho|psicologia)/i.test(
        withoutTypeChecks(read(f)),
      ),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('nothing branches on the NAME of a subject (the education context never depends on which subject it is)', () => {
    const offenders = files.filter((f) =>
      /\b(subject|s|row|existing)\.(name|nameKey)\s*[!=]==?\s*['"`]|\bnameKey\s*[!=]==?\s*['"`]/.test(
        withoutTypeChecks(read(f)),
      ),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('primaryUse is never read in the API outside the profile itself (no authorization by it)', () => {
    const api = files.filter((f) =>
      f.includes(`${path.sep}apps${path.sep}api${path.sep}src${path.sep}`),
    );
    const readers = api
      .filter((f) => /primaryUse/.test(read(f)))
      .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'));
    expect(readers.sort()).toEqual([
      // the demo seed WRITES the demo student's answer (a university student who finished the onboarding); it reads nothing
      'apps/api/src/demo/seedDemo.ts',
      'apps/api/src/repositories/profileRepository.ts',
      // completing the onboarding asks only whether the profile has an ANSWER (a skipped one is not marked COMPLETED)
      'apps/api/src/services/onboardingService.ts',
      'apps/api/src/services/profileService.ts',
      // the only other reader: the DEFAULT education context of a NEW subject (primaryUseToEducationContext), never a permission
      'apps/api/src/services/subjectMaterializer.ts',
    ]);
  });

  it('there is no role-like column on the profile or the user', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
    const models = schema.match(/model (User|UserProfile) \{[\s\S]*?\n\}/g) ?? [];
    expect(models).toHaveLength(2);
    for (const m of models) expect(m).not.toMatch(/\b(role|isAdmin|permissions?)\b\s/i);
  });
});

/**
 * A study (StudyTrack) DESCRIBES, exactly like the program: no behaviour may depend on its type or its name, nothing may
 * authorize by it, and until a later step links it to something it is read by nothing but its own files.
 */
describe('a study track describes: only periods belong to one, and no behaviour depends on it', () => {
  const api = files.filter((f) =>
    f.includes(`${path.sep}apps${path.sep}api${path.sep}src${path.sep}`),
  );
  const rel = (f: string) => path.relative(ROOT, f).replaceAll('\\', '/');

  it('only the study files, the period (which may belong to one) and the subject default know about a study', () => {
    const readers = api.filter((f) => /studyTrack/i.test(read(f))).map(rel);
    expect(readers.sort()).toEqual([
      'apps/api/src/app.ts', // wires the routes and the services
      'apps/api/src/controllers/studyTrackController.ts',
      'apps/api/src/demo/seedDemo.ts', // the demo student's primary study (and its cleanup)
      'apps/api/src/mappers.ts', // the public shape of a study and of a period
      'apps/api/src/repositories/periodRepository.ts', // a period belongs to a study or to none; the home and current lookups
      'apps/api/src/repositories/studyTrackRepository.ts',
      'apps/api/src/routes/studyTracks.ts',
      'apps/api/src/services/currentPeriods.ts', // the one reader of all the current periods (with their study)
      'apps/api/src/services/onboardingService.ts', // P0.5-5: completing the onboarding creates / adopts the first study (explicit endpoint)
      'apps/api/src/services/periodService.ts', // create / move a period, one current per scope
      'apps/api/src/services/profileService.ts', // P0.5-5: with any study, the profile's program is no longer editable (a READ of the count)
      'apps/api/src/services/studySetupService.ts', // setup / adopt-period: the two explicit, atomic ways to create a study
      'apps/api/src/services/studyTrackService.ts',
      // the DEFAULT context of a NEW subject: the type of its period's study (never a name, never a permission)
      'apps/api/src/services/subjectMaterializer.ts',
    ]);
  });

  it('nothing compares the type or the name of a study with a literal, or branches on a study type', () => {
    const offenders = files.filter((f) =>
      /\b(studyTrack|track|study)s?\??\.(type|name)\s*[!=]==?\s*['"`]|\bswitch\s*\(\s*(studyTrack|track)\w*\??\.(type|name)\b/i.test(
        withoutTypeChecks(read(f)),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no production file asks for "the" current period (ambiguous): there is HOME, and there is ALL the current ones', () => {
    const offenders = api
      .filter((f) => /\b(findCurrent|hasCurrent)\b/.test(withoutTypeChecks(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the flows that WRITE or have an implicit destination still use the HOME period, and only they do', () => {
    const home = api.filter((f) => /\.findHomeCurrent\(/.test(read(f))).map(rel);
    expect(home.sort()).toEqual([
      'apps/api/src/services/academicInboxService.ts', // interprets a pasted message against the home period's subjects
      'apps/api/src/services/activityService.ts', // a general activity without a destination
      'apps/api/src/services/captureConfirmService.ts', // Smart Capture confirmation
      'apps/api/src/services/captureService.ts',
      'apps/api/src/services/onboardingService.ts', // the period the onboarding already made is the one that becomes the study's
      'apps/api/src/services/periodService.ts', // GET /api/periods/home itself
      'apps/api/src/services/quickCaptureService.ts',
      'apps/api/src/services/scheduleImportConfirmService.ts',
      'apps/api/src/services/scheduleImportService.ts',
      'apps/api/src/services/scheduleService.ts', // a block without a period
      'apps/api/src/services/subjectBatchService.ts', // the quick setup of subjects
    ]);
  });

  it('every summary of "what needs my attention" reads ALL the current periods (one reader) and none of them is limited to HOME', () => {
    const summaries = [
      'dashboardService',
      'radarService',
      'attentionService',
      'progressService',
      'workloadService',
      'reminderService',
    ].map((n) => `apps/api/src/services/${n}.ts`);
    for (const f of summaries) {
      const code = read(path.join(ROOT, f));
      expect(code, f).toMatch(/readCurrentPeriods\(/);
      expect(code, f).not.toMatch(/findHomeCurrent/);
    }
    // the one definition of "all the current, active periods" is the lookup, and no service repeats its query
    expect(read(path.join(ROOT, 'apps/api/src/services/currentPeriods.ts'))).toMatch(
      /\.listCurrent\(/,
    );
    const duplicates = api
      .filter((f) => /isCurrent:\s*true/.test(withoutTypeChecks(read(f))))
      .map(rel)
      .sort();
    expect(duplicates).toEqual([
      'apps/api/src/demo/seedDemo.ts', // the demo asks for its period to be current
      'apps/api/src/repositories/periodRepository.ts', // the lookups themselves
      'apps/api/src/repositories/studyTrackRepository.ts', // archiving turns a study's current periods off
    ]);
  });

  it('only the period carries a study: a subject, an activity, a block, a reminder or the profile never do', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
    const model = (name: string) => {
      const start = schema.indexOf(`model ${name} {`);
      return start < 0 ? '' : schema.slice(start, schema.indexOf('\n}', start) + 2);
    };
    for (const other of ['Subject', 'Activity', 'ScheduleBlock', 'Reminder', 'UserProfile']) {
      expect(model(other), `${other} model found`).toMatch(new RegExp('model ' + other));
      expect(model(other), other).not.toMatch(/studyTrack/i);
    }
    const period = model('AcademicPeriod');
    expect(period).toMatch(/studyTrackId\s+String\?/); // nullable: NULL is a permanent, valid state
    const track = model('StudyTrack');
    expect(track).toMatch(/model StudyTrack/);
    expect(track).not.toMatch(/\b(role|isAdmin|permissions?)\b\s/i);
    // the type reuses the existing vocabulary: there is no second, equivalent enum
    expect(track).toMatch(/type\s+EducationContext\b/);
    expect(schema.match(/enum \w+ \{\s*UNIVERSITY\b/g)).toHaveLength(1);
  });

  const web = files.filter((f) =>
    f.includes(`${path.sep}apps${path.sep}web${path.sep}src${path.sep}`),
  );

  it('a study is created only by an EXPLICIT request: Mis estudios (create / setup / adopt) or the completion of the onboarding; never by the profile, registration, a login or a read', () => {
    // the only code that INSERTS a study
    const creators = api
      .filter((f) => /studyTrack/i.test(read(f)))
      .filter((f) =>
        /\bstudyTrack\.create\(|\b(studies|repo)\.create\(/.test(withoutTypeChecks(read(f))),
      )
      .map(rel);
    expect(creators.sort()).toEqual([
      'apps/api/src/repositories/studyTrackRepository.ts',
      'apps/api/src/services/onboardingService.ts', // POST /api/onboarding/complete: the student's own, explicit completion
      'apps/api/src/services/studySetupService.ts',
      'apps/api/src/services/studyTrackService.ts',
    ]);
    // the completion service is reachable ONLY from its own route (not from a login, a read or another service)
    const onboardingUsers = api
      .filter((f) => /createOnboardingService|OnboardingService/.test(read(f)))
      .map(rel);
    expect(onboardingUsers.sort()).toEqual([
      'apps/api/src/app.ts',
      'apps/api/src/controllers/onboardingController.ts',
      'apps/api/src/services/onboardingService.ts',
    ]);
    // registration and sign-in know nothing about studies: the account is born with its profile and NO study
    const auth = api.filter((f) => /[\\/]auth[\\/]authService\.ts$|routes[\\/]auth\.ts$/.test(f));
    expect(auth.length).toBeGreaterThanOrEqual(2);
    expect(
      auth
        .filter((f) => /studyTrack|studySetup|onboardingService/i.test(withoutTypeChecks(read(f))))
        .map(rel),
    ).toEqual([]);
    // the orchestration of Mis estudios reads neither the profile nor a name/type to decide anything
    const setup = withoutTypeChecks(
      read(path.join(ROOT, 'apps/api/src/services/studySetupService.ts')),
    );
    expect(setup).not.toMatch(/profile|primaryUse|programName/i);
    // NO dual write: no study service writes the profile, and the profile service never writes a study (it only READS the count)
    for (const f of ['studyTrackService', 'studySetupService']) {
      expect(
        withoutTypeChecks(read(path.join(ROOT, `apps/api/src/services/${f}.ts`))),
        f,
      ).not.toMatch(/createProfileRepository|profiles?\.update|userProfile/);
    }
    const profileService = withoutTypeChecks(
      read(path.join(ROOT, 'apps/api/src/services/profileService.ts')),
    );
    expect(profileService).not.toMatch(
      /studies\.(create|update|clearPrimary|clearCurrentPeriods)|studyTrack\.(create|update)/,
    );
    expect(profileService).toMatch(/studies\.countAll\(userId\)/);
    // the profile's controller, repository and route know nothing about studies
    const profileSide = api.filter((f) =>
      /profile(Repository|Controller)|routes\/profile/.test(rel(f)),
    );
    expect(profileSide.length).toBeGreaterThanOrEqual(3);
    expect(profileSide.filter((f) => /studyTrack|studySetup/i.test(read(f))).map(rel)).toEqual([]);
  });

  it('the onboarding never writes the profile program once a study exists: the step is not asked, and the server still refuses it', () => {
    const read2 = (f: string) => withoutTypeChecks(read(path.join(ROOT, f)));
    const model = read2('apps/web/src/onboarding/onboardingModel.ts');
    // the wizard knows whether there are studies, and then the program is settled and left out of the flow
    expect(model).toMatch(/hasStudies: boolean/);
    expect(model).toMatch(/f\.hasStudies \|\| f\.profile\.programName !== null/);
    expect(model).toMatch(/hasStudies && step === 'PROGRAM'/);
    const page = read2('apps/web/src/pages/OnboardingPage.tsx');
    // ...and it is only derived once the list of studies is KNOWN (never "no studies" while it loads)
    expect(page).toMatch(/studies\.data !== undefined\s*\?/);
    expect(page).toMatch(/studies\.isPending/);
    // the only writes of the program are the two handlers of the program step: no effect, no render-time decision
    expect(page.match(/updateProfile\.mutate\(\{ program(Key|Name)/g)).toHaveLength(2);
    // the backend defence stays for old clients and direct calls
    const profile = read2('apps/api/src/services/profileService.ts');
    expect(profile).toMatch(/PROGRAM_MANAGED_BY_STUDY/);
    expect(profile).toMatch(/studies\.countAll\(userId\)\) > 0\) throw programManagedByStudy\(\)/);
  });

  it('the profile program is NOT an authority: only the profile itself and the pure derivation of the onboarding study read it', () => {
    const readers = api.filter((f) => /programName/.test(withoutTypeChecks(read(f)))).map(rel);
    expect(readers.sort()).toEqual([
      'apps/api/src/repositories/profileRepository.ts',
      'apps/api/src/services/profileService.ts',
    ]);
    // and nothing in the API reads it to name, type or authorize a study: that goes through the pure derivation in core, once
    const onboarding = withoutTypeChecks(
      read(path.join(ROOT, 'apps/api/src/services/onboardingService.ts')),
    );
    expect(onboarding).toMatch(/studyOfOnboarding\(profile\)/);
    expect(onboarding).not.toMatch(/programName|programKey\s*[:=]\s*profile/);
  });

  it('an explicit /subjects?period= does NOT require HOME, and only the plain /subjects does', () => {
    const read2 = (f: string) => withoutTypeChecks(read(path.join(ROOT, f)));
    // the route sits outside the HOME gate (the gate would send a user without HOME to the onboarding before the page could decide)
    const app = read2('apps/web/src/App.tsx');
    expect(app.indexOf('path="/subjects"')).toBeGreaterThan(-1);
    expect(app.indexOf('path="/subjects"')).toBeLessThan(app.indexOf('<RequirePeriod />'));
    expect(app.slice(app.indexOf('<RequirePeriod />'))).not.toContain('path="/subjects"');
    // the page itself asks for HOME only in the plain mode
    const page = read2('apps/web/src/pages/SubjectsPage.tsx');
    const explicit = page.slice(
      page.indexOf('function ExplicitPeriodSubjects'),
      page.indexOf('function SubjectsView'),
    );
    const plain = page.slice(
      page.indexOf('function HomePeriodSubjects'),
      page.indexOf('function ExplicitPeriodSubjects'),
    );
    expect(explicit.length).toBeGreaterThan(200);
    expect(explicit).not.toMatch(/useHomePeriod|useCurrentPeriod|homeGate|onboarding/);
    expect(plain).toMatch(/homeGate\(home\)/);
    expect(plain).toMatch(/Navigate to="\/onboarding"/);
    // and the "Ver materias" link of a study depends only on that study having a current period
    const card = read2('apps/web/src/pages/studies/StudyCard.tsx');
    expect(card).not.toMatch(/useHomePeriod|useCurrentPeriod|canOpenSubjects/);
  });

  it('opening the Mis estudios screen cannot write: its page and its cards hold no effect and no mutation, and the onboarding knows nothing of studies', () => {
    const read2 = (p: string) => withoutTypeChecks(read(path.join(ROOT, p)));
    for (const f of [
      'apps/web/src/pages/StudiesPage.tsx',
      'apps/web/src/pages/studies/StudyCard.tsx',
      'apps/web/src/pages/studies/LegacyPlanCard.tsx',
    ]) {
      expect(read2(f), f).not.toMatch(
        /useEffect|\.mutate(Async)?\(|\buse(Setup|Adopt|Update|Make|Archive|Restore|Create)\w*\(/,
      );
    }
    const onboarding = web.filter(
      (f) =>
        /apps\/web\/src\/(onboarding\/|pages\/OnboardingPage)/.test(rel(f)) && !/\.test\./.test(f),
    );
    expect(onboarding.length).toBeGreaterThanOrEqual(6);
    expect(
      onboarding
        .filter((f) =>
          /useSetupStudy|useAdoptPeriod|useUpdateStudyTrack|useMakeStudyTrack|useArchiveStudyTrack|useRestoreStudyTrack|useCreateStudyPeriod|useUpdateStudyPeriod|settings\/studies/.test(
            read(f),
          ),
        )
        .map(rel),
    ).toEqual([]);
    // the onboarding touches a study in ONE way only: the COMPLETION endpoint (the server decides) and a READ of how many exist
    const page = read2('apps/web/src/pages/OnboardingPage.tsx');
    expect(page).toMatch(/completeOnboarding\.mutateAsync\(\)/);
    expect(page).toMatch(/useStudyTracks\(\)/);
    expect(page).not.toMatch(/studyTrack\.|studyTracks\.(create|update)|setupStudy|adoptPeriod/);
  });

  it('the web knows about studies only through the Mis estudios screens, their hooks and the labels of the summaries', () => {
    expect(web.length).toBeGreaterThan(50);
    expect(
      web
        .filter((f) => /studyTrack/i.test(read(f)))
        .map(rel)
        .sort(),
    ).toEqual([
      'apps/web/src/academic/origin.ts', // the label of an item's study, read from the server's current periods
      'apps/web/src/api/studyTracks.ts',
      'apps/web/src/pages/OnboardingPage.tsx', // READS how many studies exist (to preview what completing does); the server creates it
      'apps/web/src/pages/StudiesPage.tsx', // Mis estudios
      'apps/web/src/pages/SubjectsPage.tsx', // reads the study of the period it shows (its title); never sends one
      'apps/web/src/pages/progress/ProgressByPeriod.tsx', // one progress line per study
      'apps/web/src/pages/studies/AddStudyDialog.tsx',
      'apps/web/src/pages/studies/AdoptDialog.tsx',
      'apps/web/src/pages/studies/EditStudyDialog.tsx',
      'apps/web/src/pages/studies/PeriodsDialog.tsx',
      'apps/web/src/pages/studies/StudyActionDialog.tsx',
      'apps/web/src/studies/studyModel.ts',
      'apps/web/src/studies/studyWizardModel.ts',
      'apps/web/src/studyTracks/useStudyTracks.ts',
    ]);
    // and no workspace or study selector exists anywhere: the app stays one Home, one Agenda
    const selectors = web.filter((f) =>
      /(Cambiar|Elegir|Seleccionar)\s+(de\s+)?estudio|selectedStudy|activeStudy|setStudy|StudySwitcher|WorkspaceSwitcher/i.test(
        read(f),
      ),
    );
    expect(selectors.map(rel)).toEqual([]);
  });

  it('the current scope is a NAME, never a list of ids: nothing sends or parses periodIds, and reading is current while creating is HOME', () => {
    const noIds = [...web, ...api.filter((f) => /controllers|routes/.test(f))]
      .filter((f) => /periodIds/.test(withoutTypeChecks(read(f))))
      .map(rel);
    expect(noIds).toEqual([]);
    // (comments are stripped: a comment quoting the pattern must not satisfy the guard)
    const read2 = (p: string) => withoutTypeChecks(read(path.join(ROOT, p)));
    // READING the Activities list: all the current periods, named by the server's scope
    expect(read2('apps/web/src/pages/activities/filterParams.ts')).toMatch(/scope:\s*'current'/);
    expect(read2('apps/web/src/pages/ActivitiesPage.tsx')).toMatch(
      /useActivities\(toApiQuery\(filters\)/,
    );
    // CREATING: the home period's subjects, and the service still anchors a general activity to HOME
    expect(read2('apps/web/src/pages/ActivitiesPage.tsx')).toMatch(/useSubjects\(period\?\.id\)/);
    expect(read2('apps/api/src/services/activityService.ts')).toMatch(
      /periods\.findHomeCurrent\(actor\.id\)/,
    );
  });

  it('the web never derives HOME (or the gate of the app) from the list of periods: no "find/some current" in production', () => {
    const offenders = web.filter((f) =>
      /\.(find|some|filter)\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.isCurrent\b/.test(
        withoutTypeChecks(read(f)),
      ),
    );
    // The only ones that look for a current period inside a LIST are the Mis estudios screens, and neither finds HOME: one
    // asks whether a STUDY's own periods have a current one, the other finds the plan that belongs to no study.
    expect(offenders.map(rel).sort()).toEqual([
      'apps/web/src/pages/studies/PeriodsDialog.tsx',
      'apps/web/src/studies/studyModel.ts',
    ]);
    // and the files that decide it say HOME explicitly (a guard against the pattern matching nothing)
    const read2 = (p: string) => read(path.join(ROOT, p));
    expect(read2('apps/web/src/auth/guards.tsx')).toMatch(/useHomePeriod\(\)/);
    expect(read2('apps/web/src/academic/useAcademic.ts')).toMatch(/fetchHomePeriod/);
    expect(read2('apps/web/src/pages/OnboardingPage.tsx')).toMatch(/useHomePeriod\(\)/);
  });
});
