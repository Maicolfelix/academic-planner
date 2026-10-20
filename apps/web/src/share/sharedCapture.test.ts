import { SHARE_TTL_MS } from '@planner/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHARED_CAPTURE_KEY,
  consumeShared,
  peekShared,
  sharedNoticeText,
  stashShared,
} from './sharedCapture';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

describe('shared capture hand-off', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('window', { sessionStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores the composed text in sessionStorage only, with its time and source', () => {
    stashShared({ text: 'Parcial de redes 🧪\nmañana', notices: [] }, 1000);
    expect(peekShared(1000)).toEqual({
      text: 'Parcial de redes 🧪\nmañana',
      notices: [],
      receivedAt: 1000,
      source: 'share-target',
    });
    expect([...storage.raw.keys()]).toEqual([SHARED_CAPTURE_KEY]);
  });

  it('is taken once: after consume it is gone', () => {
    stashShared({ text: 'Quiz', notices: [] }, 1000);
    expect(peekShared(1000)?.text).toBe('Quiz');
    consumeShared();
    expect(peekShared(1000)).toBeNull();
    expect(storage.raw.size).toBe(0);
  });

  it('expires after ten minutes and is never revived', () => {
    stashShared({ text: 'Quiz', notices: [] }, 1000);
    expect(peekShared(1000 + SHARE_TTL_MS)?.text).toBe('Quiz');
    expect(peekShared(1000 + SHARE_TTL_MS + 1)).toBeNull();
  });

  it('ignores a corrupt, foreign or future payload', () => {
    const put = (v: object) => storage.setItem(SHARED_CAPTURE_KEY, JSON.stringify(v));
    storage.setItem(SHARED_CAPTURE_KEY, '{not json');
    expect(peekShared()).toBeNull();
    put({ text: 'x', receivedAt: 1, source: 'other', notices: [] });
    expect(peekShared(2)).toBeNull();
    put({ text: 'x', receivedAt: 1, source: 'share-target', notices: ['<b>'] });
    expect(peekShared(2)).toBeNull();
    put({ text: 'x', receivedAt: 9e12, source: 'share-target', notices: [] });
    expect(peekShared(2)).toBeNull();
  });

  it('works without storage (blocked): nothing is carried, nothing throws', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(() => stashShared({ text: 'x', notices: [] })).not.toThrow();
    expect(peekShared()).toBeNull();
    expect(() => consumeShared()).not.toThrow();
  });

  it('a new share replaces one nobody took', () => {
    stashShared({ text: 'viejo', notices: [] }, 1000);
    stashShared({ text: 'nuevo', notices: [] }, 2000);
    expect(peekShared(2000)?.text).toBe('nuevo');
  });

  it('words the notices', () => {
    expect(sharedNoticeText(['EMPTY'])).toBe('No recibimos contenido para compartir.');
    expect(sharedNoticeText(['URL_DROPPED', 'TRUNCATED'])).toContain('recortó');
  });
});
