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
      'apps/api/src/mappers.ts', // the public shape of a study and of a period
      'apps/api/src/repositories/periodRepository.ts', // a period belongs to a study or to none; the home and current lookups
      'apps/api/src/repositories/studyTrackRepository.ts',
      'apps/api/src/routes/studyTracks.ts',
      'apps/api/src/services/periodService.ts', // create / move a period, one current per scope
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

  it('no production file asks for "the" current period any more: the singular consumers say HOME explicitly', () => {
    const offenders = api
      .filter((f) => /\b(findCurrent|hasCurrent)\b/.test(withoutTypeChecks(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
    // and there are consumers of the explicit one (a guard against the pattern matching nothing)
    expect(api.filter((f) => /\bfindHomeCurrent\(/.test(read(f))).length).toBeGreaterThanOrEqual(
      12,
    );
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

  it('the web knows about studies only through the few actions that can move HOME (no screen, no onboarding)', () => {
    expect(web.length).toBeGreaterThan(50);
    expect(
      web
        .filter((f) => /studyTrack/i.test(read(f)))
        .map(rel)
        .sort(),
    ).toEqual(['apps/web/src/api/studyTracks.ts', 'apps/web/src/studyTracks/useStudyTracks.ts']);
  });

  it('the web never derives HOME (or the gate of the app) from the list of periods: no "find/some current" in production', () => {
    const offenders = web.filter((f) =>
      /\.(find|some|filter)\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.isCurrent\b/.test(
        withoutTypeChecks(read(f)),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
    // and the files that decide it say HOME explicitly (a guard against the pattern matching nothing)
    const read2 = (p: string) => read(path.join(ROOT, p));
    expect(read2('apps/web/src/auth/guards.tsx')).toMatch(/useHomePeriod\(\)/);
    expect(read2('apps/web/src/academic/useAcademic.ts')).toMatch(/fetchHomePeriod/);
    expect(read2('apps/web/src/pages/OnboardingPage.tsx')).toMatch(/useHomePeriod\(\)/);
  });
});
