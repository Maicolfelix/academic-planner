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
