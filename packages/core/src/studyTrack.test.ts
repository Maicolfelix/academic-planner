import { describe, expect, it } from 'vitest';
import { EDUCATION_CONTEXTS } from './academic.js';
import { PROGRAM_CATALOG } from './profile.js';
import {
  STUDY_TRACK_NAME_MAX,
  createStudyTrackSchema,
  programOfNewTrack,
  resolveStudyTrackProgram,
  studyTrackListResponseSchema,
  studyTrackNameSchema,
  studyTrackResponseSchema,
  updateStudyTrackSchema,
} from './studyTrack.js';

const create = (v: unknown) => createStudyTrackSchema.safeParse(v);
const update = (v: unknown) => updateStudyTrackSchema.safeParse(v);
const messageOf = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message).join(' | ');

describe('the name of a study (a visible label, not necessarily a career)', () => {
  it('accepts the ordinary names, trimmed', () => {
    for (const n of [
      'Medicina',
      'Colegio',
      'Universidad',
      'Técnico en Sistemas',
      'Diplomado en Ciberseguridad',
      'Inglés B2',
    ]) {
      expect(studyTrackNameSchema.parse(`  ${n}  `)).toBe(n);
    }
  });

  it('refuses an empty or blank name, one that is too long, and a NUL', () => {
    expect(studyTrackNameSchema.safeParse('').success).toBe(false);
    expect(studyTrackNameSchema.safeParse('   ').success).toBe(false);
    expect(studyTrackNameSchema.safeParse('x'.repeat(STUDY_TRACK_NAME_MAX)).success).toBe(true);
    expect(studyTrackNameSchema.safeParse('x'.repeat(STUDY_TRACK_NAME_MAX + 1)).success).toBe(
      false,
    );
    expect(studyTrackNameSchema.safeParse('Medi\u0000cina').success).toBe(false);
    expect(studyTrackNameSchema.safeParse(7).success).toBe(false);
  });
});

describe('creating a study', () => {
  it('a valid custom study: a name and a type, no key', () => {
    expect(create({ name: ' Inglés B2 ', type: 'OTHER_ACADEMIC' })).toMatchObject({
      success: true,
      data: { name: 'Inglés B2', type: 'OTHER_ACADEMIC' },
    });
  });

  it('the type is one of the three education contexts (the same vocabulary, no second enum) and never PERSONAL', () => {
    for (const type of EDUCATION_CONTEXTS) expect(create({ name: 'X', type }).success).toBe(true);
    expect(create({ name: 'X', type: 'PERSONAL' }).success).toBe(false);
    expect(create({ name: 'X', type: 'university' }).success).toBe(false);
    expect(create({ name: 'X' }).success).toBe(false); // the type is required
  });

  it('a catalog key brings its canonical name, so the name may be left out', () => {
    const r = create({ type: 'UNIVERSITY', programKey: 'medicina' });
    expect(r.success).toBe(true);
    expect(programOfNewTrack(r.data!)).toEqual({ programKey: 'medicina', name: 'Medicina' });
  });

  it('every catalog entry is a valid key with its own name, and never with another one', () => {
    for (const p of PROGRAM_CATALOG) {
      expect(create({ type: 'UNIVERSITY', programKey: p.key, name: p.name }).success).toBe(true);
    }
    const r = create({ type: 'UNIVERSITY', programKey: 'medicina', name: 'Derecho' });
    expect(r.success).toBe(false);
    expect(messageOf(r)).toContain('no corresponde');
  });

  it('a key that is not in the catalog is refused', () => {
    expect(create({ type: 'UNIVERSITY', programKey: 'astrologia', name: 'X' }).success).toBe(false);
    expect(create({ type: 'UNIVERSITY', programKey: 'x'.repeat(61) }).success).toBe(false);
  });

  it('without a key the name is required: it is the study', () => {
    expect(create({ type: 'SCHOOL' }).success).toBe(false);
    expect(create({ type: 'SCHOOL', programKey: null }).success).toBe(false);
    expect(programOfNewTrack(create({ type: 'SCHOOL', name: 'Colegio' }).data!)).toEqual({
      programKey: null,
      name: 'Colegio',
    });
  });

  it('is strict: no owner, no primary flag, no status, no period, no primary use, nothing unknown', () => {
    const ok = { name: 'Colegio', type: 'SCHOOL' };
    for (const extra of [
      { userId: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41' },
      { id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41' },
      { isPrimary: true },
      { status: 'ARCHIVED' },
      { periodId: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41' },
      { primaryUse: 'SCHOOL_STUDENT' },
      { color: 'red' },
    ]) {
      expect(create({ ...ok, ...extra }).success).toBe(false);
    }
  });
});

describe('updating a study', () => {
  it('only describes: a name, a type, a key; nothing else, and not nothing', () => {
    expect(update({ name: 'Medicina' }).success).toBe(true);
    expect(update({ type: 'UNIVERSITY' }).success).toBe(true);
    expect(update({ programKey: null }).success).toBe(true);
    expect(update({}).success).toBe(false);
    for (const extra of [
      { isPrimary: true },
      { status: 'ARCHIVED' },
      { userId: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41' },
    ]) {
      expect(update({ name: 'X', ...extra }).success).toBe(false);
    }
  });

  it('the type can change to any of the three (it is descriptive and correctable)', () => {
    for (const type of EDUCATION_CONTEXTS) expect(update({ type }).success).toBe(true);
    expect(update({ type: 'PERSONAL' }).success).toBe(false);
  });

  it('a key and a different name together are refused; a bad name or key too', () => {
    expect(update({ programKey: 'medicina', name: 'Derecho' }).success).toBe(false);
    expect(update({ programKey: 'medicina', name: 'Medicina' }).success).toBe(true);
    expect(update({ programKey: 'astrologia' }).success).toBe(false);
    expect(update({ name: '' }).success).toBe(false);
    expect(update({ name: 'a\u0000b' }).success).toBe(false);
  });
});

describe('which name and key a study ends up with', () => {
  const catalog = { programKey: 'medicina', name: 'Medicina' };
  const custom = { programKey: null, name: 'Inglés B2' };

  it('a catalog key sets the canonical name', () => {
    expect(resolveStudyTrackProgram(custom, { programKey: 'derecho' })).toEqual({
      programKey: 'derecho',
      name: 'Derecho',
    });
  });

  it('a different name makes it a study of their own: the key is dropped (never medicina + Derecho)', () => {
    expect(resolveStudyTrackProgram(catalog, { name: 'Medicina del Deporte' })).toEqual({
      programKey: null,
      name: 'Medicina del Deporte',
    });
    expect(resolveStudyTrackProgram(catalog, { name: 'Derecho', programKey: null })).toEqual({
      programKey: null,
      name: 'Derecho',
    });
  });

  it('the very same name keeps the key; only programKey null keeps the name and drops the key', () => {
    expect(resolveStudyTrackProgram(catalog, { name: 'Medicina' })).toEqual(catalog);
    expect(resolveStudyTrackProgram(catalog, { programKey: null })).toEqual({
      programKey: null,
      name: 'Medicina',
    });
  });

  it('a custom study renamed stays custom; nothing to change changes nothing', () => {
    expect(resolveStudyTrackProgram(custom, { name: 'Inglés C1' })).toEqual({
      programKey: null,
      name: 'Inglés C1',
    });
    expect(resolveStudyTrackProgram(catalog, {})).toEqual(catalog);
  });
});

describe('the response shapes', () => {
  const track = {
    id: '7c1d5f10-1b2e-4a38-8f6a-5b9c0d3e2a41',
    name: 'Medicina',
    type: 'UNIVERSITY',
    programKey: 'medicina',
    isPrimary: true,
    status: 'ACTIVE',
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  };

  it('one study, and a list of them', () => {
    expect(studyTrackResponseSchema.safeParse({ studyTrack: track }).success).toBe(true);
    expect(studyTrackListResponseSchema.safeParse({ studyTracks: [track, track] }).success).toBe(
      true,
    );
    expect(studyTrackListResponseSchema.safeParse({ studyTracks: [] }).success).toBe(true);
  });

  it('carries no owner', () => {
    expect(Object.keys(track)).not.toContain('userId');
  });
});
