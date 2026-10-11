import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { z } from 'zod';

/**
 * PERSISTENT DRAFTS: work the student has not saved yet survives closing a dialog, changing page, reloading and the
 * browser rebuilding the tab (Safari on a phone does that). It is a convenience of THIS browser, not a sync: nothing goes
 * to the server, nothing is replayed, and a draft never creates anything by itself.
 *
 * Storage: `localStorage`, on purpose. The drafts are small (a form, or up to ten proposals), it is synchronous (a draft can
 * be flushed from `pagehide`, where an asynchronous write may never finish) and it survives a reload. `sessionStorage` does
 * not survive the tab being rebuilt; IndexedDB buys nothing at this size and is asynchronous exactly where it hurts.
 *
 * What is stored, under `academic-planner:draft:v1:<userId>:<scope>`: `{ version, updatedAt, payload }`. Never an email, a
 * token or anything of the session. A draft is private to its user (the key carries their id), expires after seven days,
 * and is dropped, never repaired, when it is corrupt, from another version or no longer matches its schema. Every access
 * is guarded: with storage blocked (a private window, a full quota) the app simply works without drafts.
 *
 * Last write wins across tabs: each write replaces the whole entry, so two tabs never corrupt it.
 */

export const DRAFT_NAMESPACE = 'academic-planner:draft';
export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const draftKey = (userId: string, scope: string) =>
  `${DRAFT_NAMESPACE}:v${DRAFT_VERSION}:${userId}:${scope}`;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked storage throws on access
  }
}

interface Envelope {
  version: number;
  updatedAt: number;
  payload: unknown;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Envelope).version === 'number' &&
  typeof (value as Envelope).updatedAt === 'number' &&
  'payload' in value;

export interface StoredDraft<T> {
  payload: T;
  updatedAt: number;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Subscribes to changes of any draft: in this tab (our own writes) and in another one (the `storage` event). */
export function subscribeDrafts(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function rawOf(userId: string, scope: string): string | null {
  try {
    return store()?.getItem(draftKey(userId, scope)) ?? null;
  } catch {
    return null;
  }
}

/** Validates a stored string without touching storage (the reading side of `readDraft`). */
function decode<T>(
  raw: string | null,
  schema: z.ZodType<T>,
  /** null: do not judge the expiry (the caller is rendering, where the clock must not be read). */
  now: number | null,
): StoredDraft<T> | null {
  if (raw === null) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isEnvelope(envelope) || envelope.version !== DRAFT_VERSION) return null;
    if (now !== null && now - envelope.updatedAt > DRAFT_TTL_MS) return null;
    const parsed = schema.safeParse(envelope.payload);
    return parsed.success ? { payload: parsed.data, updatedAt: envelope.updatedAt } : null;
  } catch {
    return null;
  }
}

/**
 * The draft of this user and scope as it is NOW, kept up to date when it is written, cleared or changed from another tab.
 * For showing "you have something unfinished" (it never writes).
 */
export function useStoredDraft<T>(
  userId: string | undefined,
  scope: string,
  schema: z.ZodType<T>,
): StoredDraft<T> | null {
  const raw = useSyncExternalStore(
    subscribeDrafts,
    () => (userId ? rawOf(userId, scope) : null),
    () => null,
  );
  // (an expired draft is swept when the app opens and judged strictly by `readDraft` when it is taken up)
  return useMemo(() => decode(raw, schema, null), [raw, schema]);
}

/** The draft of this user and scope, or null (none, expired, corrupt, another version or another shape). */
export function readDraft<T>(
  userId: string,
  scope: string,
  schema: z.ZodType<T>,
  now = Date.now(),
): StoredDraft<T> | null {
  const s = store();
  if (!s) return null;
  const key = draftKey(userId, scope);
  try {
    const raw = s.getItem(key);
    if (raw === null) return null;
    const envelope: unknown = JSON.parse(raw);
    if (
      !isEnvelope(envelope) ||
      envelope.version !== DRAFT_VERSION ||
      now - envelope.updatedAt > DRAFT_TTL_MS
    ) {
      s.removeItem(key);
      return null;
    }
    const parsed = schema.safeParse(envelope.payload);
    if (!parsed.success) {
      s.removeItem(key);
      return null;
    }
    return { payload: parsed.data, updatedAt: envelope.updatedAt };
  } catch {
    try {
      s.removeItem(key);
    } catch {
      /* nothing else to do */
    }
    return null;
  }
}

/** Saves the draft (replacing the previous one). false when it could not be stored: the app works without it. */
export function writeDraft(
  userId: string,
  scope: string,
  payload: unknown,
  now = Date.now(),
): boolean {
  const s = store();
  if (!s) return false;
  try {
    const envelope: Envelope = { version: DRAFT_VERSION, updatedAt: now, payload };
    s.setItem(draftKey(userId, scope), JSON.stringify(envelope));
    notify();
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(userId: string, scope: string): void {
  try {
    store()?.removeItem(draftKey(userId, scope));
  } catch {
    /* nothing else to do */
  }
  notify();
}

/** Removes every expired or unreadable draft of the user (cheap; run when the app opens). */
export function sweepDrafts(userId: string, now = Date.now()): void {
  const s = store();
  if (!s) return;
  try {
    const prefix = `${DRAFT_NAMESPACE}:v${DRAFT_VERSION}:${userId}:`;
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const envelope: unknown = JSON.parse(s.getItem(key) ?? 'null');
        if (!isEnvelope(envelope) || now - envelope.updatedAt > DRAFT_TTL_MS) stale.push(key);
      } catch {
        stale.push(key);
      }
    }
    for (const key of stale) s.removeItem(key);
  } catch {
    /* nothing else to do */
  }
}

const SAVE_DELAY_MS = 300;

/**
 * The writing side of a draft: `save(payload)` stores it a moment after the last change (typing is not a write per key),
 * `save(null)` or `clear()` removes it at once, and whatever is pending is written when the component goes away or the
 * page is hidden/closed — so closing a dialog or leaving the page never loses the last keystrokes.
 *
 * Nothing is written without a user (the draft is private to one) or a scope.
 */
export function useDraftWriter(userId: string | undefined, scope: string | null) {
  const pending = useRef<{ payload: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const target = useRef({ userId, scope });
  // The latest user and scope, for the writes that happen later (kept in an effect: refs are not touched while rendering).
  useEffect(() => {
    target.current = { userId, scope };
  }, [userId, scope]);

  const flush = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    const job = pending.current;
    pending.current = null;
    const { userId: u, scope: sc } = target.current;
    if (job && u && sc) writeDraft(u, sc, job.payload);
  }, []);

  const clear = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
    const { userId: u, scope: sc } = target.current;
    if (u && sc) clearDraft(u, sc);
  }, []);

  const save = useCallback(
    (payload: unknown | null) => {
      if (payload === null) return clear();
      pending.current = { payload };
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [clear, flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush(); // the component goes away (a dialog closes, the route changes): the last change is kept
    };
  }, [flush]);

  return { save, clear, flush };
}
