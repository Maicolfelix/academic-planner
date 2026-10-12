import { describe, expect, it } from 'vitest';
import { normalizeNameKey } from './academic.js';
import {
  ONBOARDING_STATUSES,
  PRIMARY_USES,
  PROFILE_PROGRAM_NAME_MAX,
  PROGRAM_CATALOG,
  findProgramByKey,
  isOnboardingTransitionAllowed,
  profileSchema,
  resolveProgram,
  updateProfileSchema,
  type OnboardingStatus,
} from './profile.js';

const ok = (v: unknown) => updateProfileSchema.safeParse(v);
const messages = (v: unknown) => {
  const r = ok(v);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('primary use and onboarding status', () => {
  it('has the five uses and four statuses, and no role-like value', () => {
    expect(PRIMARY_USES).toEqual([
      'UNIVERSITY_STUDENT',
      'SCHOOL_STUDENT',
      'OTHER_STUDENT',
      'TEACHER',
      'PERSONAL',
    ]);
    expect(ONBOARDING_STATUSES).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']);
    expect(PRIMARY_USES.join()).not.toMatch(/ADMIN|ROLE|OWNER/);
  });

  it('the profile shape: everything null but the status is a valid profile', () => {
    expect(
      profileSchema.safeParse({
        primaryUse: null,
        programName: null,
        programKey: null,
        onboardingStatus: 'NOT_STARTED',
      }).success,
    ).toBe(true);
    expect(
      profileSchema.safeParse({
        primaryUse: 'ADMIN',
        programName: null,
        programKey: null,
        onboardingStatus: 'NOT_STARTED',
      }).success,
    ).toBe(false);
  });

  it('accepts each use, null to clear it, and nothing else', () => {
    for (const primaryUse of PRIMARY_USES) expect(ok({ primaryUse }).success).toBe(true);
    expect(ok({ primaryUse: null }).success).toBe(true);
    expect(ok({ primaryUse: 'ADMIN' }).success).toBe(false);
    expect(ok({ primaryUse: 'university_student' }).success).toBe(false);
  });

  it('a client can ask for IN_PROGRESS, COMPLETED or SKIPPED, never for NOT_STARTED', () => {
    for (const onboardingStatus of ['IN_PROGRESS', 'COMPLETED', 'SKIPPED']) {
      expect(ok({ onboardingStatus }).success).toBe(true);
    }
    expect(ok({ onboardingStatus: 'NOT_STARTED' }).success).toBe(false);
    expect(ok({ onboardingStatus: 'DONE' }).success).toBe(false);
  });
});

describe('transitions', () => {
  const allowed: [OnboardingStatus, OnboardingStatus][] = [
    ['NOT_STARTED', 'IN_PROGRESS'],
    ['NOT_STARTED', 'SKIPPED'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['IN_PROGRESS', 'SKIPPED'],
    ['SKIPPED', 'IN_PROGRESS'],
    ['COMPLETED', 'IN_PROGRESS'],
  ];

  it.each(allowed)('%s -> %s is allowed', (from, to) => {
    expect(isOnboardingTransitionAllowed(from, to)).toBe(true);
  });

  it('everything else is refused, except asking for the state it already has', () => {
    const refused: [OnboardingStatus, OnboardingStatus][] = [
      ['NOT_STARTED', 'COMPLETED'],
      ['SKIPPED', 'COMPLETED'],
      ['COMPLETED', 'SKIPPED'],
      ['IN_PROGRESS', 'NOT_STARTED'],
      ['COMPLETED', 'NOT_STARTED'],
      ['SKIPPED', 'NOT_STARTED'],
    ];
    for (const [from, to] of refused) {
      expect(isOnboardingTransitionAllowed(from, to), `${from}>${to}`).toBe(false);
    }
    for (const s of ONBOARDING_STATUSES) expect(isOnboardingTransitionAllowed(s, s)).toBe(true);
  });
});

describe('the program catalog', () => {
  it('has unique keys and unique normalized names, ASCII keys, and names within the limit', () => {
    expect(new Set(PROGRAM_CATALOG.map((p) => p.key)).size).toBe(PROGRAM_CATALOG.length);
    expect(new Set(PROGRAM_CATALOG.map((p) => normalizeNameKey(p.name))).size).toBe(
      PROGRAM_CATALOG.length,
    );
    for (const p of PROGRAM_CATALOG) {
      expect(p.key, p.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.name.length).toBeLessThanOrEqual(PROFILE_PROGRAM_NAME_MAX);
    }
  });

  it('is small and varied, and searchable with normalizeNameKey', () => {
    expect(PROGRAM_CATALOG.length).toBeLessThan(60);
    for (const name of [
      'Medicina',
      'Derecho',
      'Psicología',
      'Ingeniería de Sistemas',
      'Enfermería',
    ]) {
      expect(
        PROGRAM_CATALOG.some((p) => p.name === name),
        name,
      ).toBe(true);
    }
    const found = PROGRAM_CATALOG.filter((p) => normalizeNameKey(p.name).includes('ingenieria'));
    expect(found.length).toBeGreaterThan(2);
    expect(
      PROGRAM_CATALOG.find((p) => normalizeNameKey(p.name) === normalizeNameKey('PSICOLOGIA'))?.key,
    ).toBe('psicologia');
  });

  it('looks a program up by key, and an unknown key finds nothing', () => {
    expect(findProgramByKey('medicina')).toEqual({ key: 'medicina', name: 'Medicina' });
    expect(findProgramByKey('nope')).toBeUndefined();
    expect(findProgramByKey('')).toBeUndefined();
    expect(findProgramByKey('__proto__')).toBeUndefined();
  });
});

describe('the program in an update', () => {
  it('a catalog key alone is valid (the server derives the name), with its canonical name too', () => {
    expect(ok({ programKey: 'medicina' }).success).toBe(true);
    expect(ok({ programKey: 'medicina', programName: 'Medicina' }).success).toBe(true);
  });

  it('an unknown key, a key with another name, or a key with a null name is refused', () => {
    expect(messages({ programKey: 'astrologia' })).toEqual(['programKey: Programa no válido.']);
    expect(messages({ programKey: 'medicina', programName: 'Derecho' })).toEqual([
      'programName: El nombre no corresponde al programa elegido.',
    ]);
    expect(ok({ programKey: 'medicina', programName: 'medicina' }).success).toBe(false);
    expect(ok({ programKey: 'medicina', programName: null }).success).toBe(false);
  });

  it('a custom program is a name with no key, trimmed, 1..80, no NUL', () => {
    expect(ok({ programName: '  Mi carrera  ' }).success).toBe(true);
    expect(updateProfileSchema.parse({ programName: '  Mi carrera  ' }).programName).toBe(
      'Mi carrera',
    );
    expect(ok({ programKey: null, programName: 'Otra' }).success).toBe(true);
    expect(ok({ programName: 'x'.repeat(80) }).success).toBe(true);
    expect(ok({ programName: 'x'.repeat(81) }).success).toBe(false);
    expect(ok({ programName: '' }).success).toBe(false);
    expect(ok({ programName: '   ' }).success).toBe(false);
    expect(ok({ programName: 'Med\u0000icina' }).success).toBe(false);
  });

  it('both null clears the program', () => {
    expect(ok({ programKey: null, programName: null }).success).toBe(true);
  });

  it('is strict: no owner, e-mail, timezone or unknown field, and not empty', () => {
    for (const extra of [
      { userId: 'u' },
      { ownerId: 'u' },
      { email: 'a@b.co' },
      { timezone: 'Asia/Tokyo' },
      { role: 'ADMIN' },
      { createdAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      expect(ok({ primaryUse: 'PERSONAL', ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(messages({})).toEqual([': No hay nada que actualizar.']);
    expect(ok(null).success).toBe(false);
  });
});

describe('resolveProgram: the name is the authority', () => {
  const none = { programKey: null, programName: null };
  const medicine = { programKey: 'medicina', programName: 'Medicina' };

  it('a catalog key brings the canonical name', () => {
    expect(resolveProgram(none, { programKey: 'derecho' })).toEqual({
      programKey: 'derecho',
      programName: 'Derecho',
    });
    // even if a (validated, equal) name came along
    expect(resolveProgram(none, { programKey: 'derecho', programName: 'Derecho' })).toEqual({
      programKey: 'derecho',
      programName: 'Derecho',
    });
  });

  it('the canonical name wins even over a name that was not validated (defence in depth)', () => {
    expect(resolveProgram(none, { programKey: 'derecho', programName: 'Medicina' })).toEqual({
      programKey: 'derecho',
      programName: 'Derecho',
    });
  });

  it('a custom name drops the key it came with', () => {
    expect(resolveProgram(medicine, { programName: 'Medicina del deporte' })).toEqual({
      programKey: null,
      programName: 'Medicina del deporte',
    });
  });

  it('null clears both, or only the key detaches the program as a custom one', () => {
    expect(resolveProgram(medicine, { programKey: null, programName: null })).toEqual(none);
    expect(resolveProgram(medicine, { programName: null })).toEqual(none);
    expect(resolveProgram(medicine, { programKey: null })).toEqual({
      programKey: null,
      programName: 'Medicina',
    });
  });

  it('nothing about the program leaves it as it is', () => {
    expect(resolveProgram(medicine, {})).toBe(medicine);
  });
});
