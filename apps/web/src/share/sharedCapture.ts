import {
  SHARE_NOTICE_MESSAGES,
  SHARE_TTL_MS,
  type ComposedShare,
  type ShareNotice,
} from '@planner/core';

/**
 * The hand-off between `/share` (where the OS delivers title/text/url in the URL) and the Quick Capture box. The shared content
 * stays in THIS tab only: `sessionStorage`, never `localStorage`, never the server, never the URL after the hand-off. It expires
 * in ten minutes and is taken once: after `consumeShared` it is gone, and a reload does not bring it back.
 */
export const SHARED_CAPTURE_KEY = 'academic-planner:shared-capture';

export interface SharedCapture {
  text: string;
  notices: ShareNotice[];
  receivedAt: number;
  source: 'share-target';
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // blocked storage throws on access
  }
}

const NOTICES: readonly string[] = Object.keys(SHARE_NOTICE_MESSAGES);

/** Keeps what `/share` composed until the capture box takes it. A new share replaces an older one that was never taken. */
export function stashShared(share: ComposedShare, now = Date.now()): void {
  const payload: SharedCapture = {
    text: share.text,
    notices: share.notices,
    receivedAt: now,
    source: 'share-target',
  };
  try {
    store()?.setItem(SHARED_CAPTURE_KEY, JSON.stringify(payload));
  } catch {
    // full or blocked storage: the share is simply not carried
  }
}

/** Reads without taking (safe to call while rendering). Expired or malformed content is ignored. */
export function peekShared(now = Date.now()): SharedCapture | null {
  try {
    const raw = store()?.getItem(SHARED_CAPTURE_KEY) ?? null;
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<SharedCapture> | null;
    if (
      !v ||
      v.source !== 'share-target' ||
      typeof v.text !== 'string' ||
      typeof v.receivedAt !== 'number' ||
      !Array.isArray(v.notices) ||
      !v.notices.every((n) => typeof n === 'string' && NOTICES.includes(n))
    )
      return null;
    if (now - v.receivedAt > SHARE_TTL_MS || v.receivedAt > now + 60_000) return null;
    return v as SharedCapture;
  } catch {
    return null;
  }
}

/** Takes it: removes the stored share (also when it was expired or corrupt). */
export function consumeShared(): void {
  try {
    store()?.removeItem(SHARED_CAPTURE_KEY);
  } catch {
    // nothing to do
  }
}

/**
 * Takes the share ONLY once the caller says it is safely kept (the text is a durable draft). Until then it stays in the tab, so
 * anything that interrupts the hand-off (a remount, a reload, storage that failed to write) cannot lose it: one delivery,
 * not "removed before the box could keep it". Returns whether it was taken.
 */
export function deliverShared(persist: () => boolean): boolean {
  if (!persist()) return false;
  consumeShared();
  return true;
}

export const sharedNoticeText = (notices: readonly ShareNotice[]) =>
  notices.map((n) => SHARE_NOTICE_MESSAGES[n]).join(' ');

export interface ShareHandoff {
  /** Text to put in an empty box right away. */
  preload: string | null;
  /** With an unfinished draft the share waits for the student's decision, notices included. */
  offer: SharedCapture | null;
  /** What to tell now (a share taken straight away, or one that carried no text). */
  notice: string;
}

/** What the Quick Capture does with a share: take it, or ask first when there is a draft. Pure, so it can be tested. */
export function planHandoff(shared: SharedCapture | null, hasDraft: boolean): ShareHandoff {
  if (!shared) return { preload: null, offer: null, notice: '' };
  const text = shared.text !== '' ? shared.text : null;
  if (text !== null && hasDraft) return { preload: null, offer: shared, notice: '' };
  return { preload: text, offer: null, notice: sharedNoticeText(shared.notices) };
}
