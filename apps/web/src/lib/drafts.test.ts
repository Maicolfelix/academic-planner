import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DRAFT_TTL_MS,
  DRAFT_VERSION,
  clearDraft,
  draftKey,
  readDraft,
  sweepDrafts,
  writeDraft,
} from './drafts';

/** A Storage in memory, with the one failure a browser really has: refusing to write (full quota, private window). */
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(key, value);
  }
}

const schema = z.object({ title: z.string(), n: z.number() });
let storage: MemoryStorage;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('window', {
    localStorage: storage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('persistent drafts', () => {
  it('keeps what was written and gives it back', () => {
    expect(writeDraft('u1', 'activity-create:p1', { title: 'Ensayo', n: 1 }, NOW)).toBe(true);
    expect(readDraft('u1', 'activity-create:p1', schema, NOW + 1000)).toEqual({
      payload: { title: 'Ensayo', n: 1 },
      updatedAt: NOW,
    });
  });

  it('is private to its user: another account never sees it', () => {
    writeDraft('user-a', 'capture-quick', { title: 'de A', n: 1 }, NOW);
    expect(readDraft('user-b', 'capture-quick', schema, NOW)).toBeNull();
    expect(draftKey('user-a', 'x')).not.toBe(draftKey('user-b', 'x'));
  });

  it('keeps scopes apart: creating, editing one activity and another, quick and inbox', () => {
    writeDraft('u', 'activity-create:p1', { title: 'nueva', n: 1 }, NOW);
    writeDraft('u', 'activity-edit:a1', { title: 'edición a1', n: 2 }, NOW);
    writeDraft('u', 'activity-edit:a2', { title: 'edición a2', n: 3 }, NOW);
    expect(readDraft('u', 'activity-edit:a1', schema, NOW)?.payload.title).toBe('edición a1');
    expect(readDraft('u', 'activity-edit:a2', schema, NOW)?.payload.title).toBe('edición a2');
    expect(readDraft('u', 'activity-create:p1', schema, NOW)?.payload.title).toBe('nueva');
    expect(readDraft('u', 'capture-quick', schema, NOW)).toBeNull();
  });

  it('expires after seven days, and expiring removes it', () => {
    writeDraft('u', 's', { title: 'x', n: 1 }, NOW);
    expect(readDraft('u', 's', schema, NOW + DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(readDraft('u', 's', schema, NOW + DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.getItem(draftKey('u', 's'))).toBeNull();
  });

  it('a corrupt entry is dropped, not repaired, and nothing breaks', () => {
    storage.setItem(draftKey('u', 's'), '{not json');
    expect(readDraft('u', 's', schema, NOW)).toBeNull();
    expect(storage.getItem(draftKey('u', 's'))).toBeNull();
  });

  it('another version of the format is ignored', () => {
    storage.setItem(
      draftKey('u', 's'),
      JSON.stringify({ version: DRAFT_VERSION + 1, updatedAt: NOW, payload: { title: 'x', n: 1 } }),
    );
    expect(readDraft('u', 's', schema, NOW)).toBeNull();
  });

  it('a payload that no longer has the shape is dropped', () => {
    writeDraft('u', 's', { title: 5, n: 'x' }, NOW);
    expect(readDraft('u', 's', schema, NOW)).toBeNull();
    expect(storage.getItem(draftKey('u', 's'))).toBeNull();
  });

  it('not an envelope at all (a number, null, an array) is dropped', () => {
    for (const raw of ['5', 'null', '[]', '"x"', '{"version":1}']) {
      storage.setItem(draftKey('u', 's'), raw);
      expect(readDraft('u', 's', schema, NOW), raw).toBeNull();
    }
  });

  it('clears on request', () => {
    writeDraft('u', 's', { title: 'x', n: 1 }, NOW);
    clearDraft('u', 's');
    expect(readDraft('u', 's', schema, NOW)).toBeNull();
  });

  it('a full or refused storage means "no draft", never an error', () => {
    storage.failWrites = true;
    expect(writeDraft('u', 's', { title: 'x', n: 1 }, NOW)).toBe(false);
    expect(readDraft('u', 's', schema, NOW)).toBeNull();
  });

  it('storage that throws on access (blocked) works as no storage', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(writeDraft('u', 's', { title: 'x', n: 1 }, NOW)).toBe(false);
    expect(readDraft('u', 's', schema, NOW)).toBeNull();
    expect(() => clearDraft('u', 's')).not.toThrow();
    expect(() => sweepDrafts('u')).not.toThrow();
  });

  it('never stores anything of the session: the entry is the payload and nothing else', () => {
    writeDraft('u', 's', { title: 'x', n: 1 }, NOW);
    const raw = JSON.parse(storage.getItem(draftKey('u', 's'))!) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['payload', 'updatedAt', 'version']);
  });

  it('the sweep removes the expired and the unreadable of the user, and only theirs', () => {
    writeDraft('u', 'old', { title: 'x', n: 1 }, NOW - DRAFT_TTL_MS - 5);
    writeDraft('u', 'fresh', { title: 'x', n: 1 }, NOW);
    storage.setItem(draftKey('u', 'bad'), 'garbage');
    writeDraft('other', 'old', { title: 'x', n: 1 }, NOW - DRAFT_TTL_MS - 5);
    storage.setItem('something-else', 'keep me');
    sweepDrafts('u', NOW);
    expect(storage.getItem(draftKey('u', 'old'))).toBeNull();
    expect(storage.getItem(draftKey('u', 'bad'))).toBeNull();
    expect(storage.getItem(draftKey('u', 'fresh'))).not.toBeNull();
    expect(storage.getItem(draftKey('other', 'old'))).not.toBeNull(); // not this user's business
    expect(storage.getItem('something-else')).toBe('keep me');
  });
});
