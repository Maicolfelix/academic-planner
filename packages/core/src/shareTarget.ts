import { CAPTURE_MAX_LENGTH } from './captureProposals.js';

/**
 * Web Share Target (A5): what another app shares (title, text, url) becomes the text of a Quick Capture. Pure rules, no browser:
 * the page reads the query, calls `composeSharedText` and hands the result to the capture box. Nothing is created by a share.
 */

export const SHARE_LIMITS = { title: 200, text: 5000, url: 2048 } as const;
/** A share not taken within this time is forgotten (it is never revived). */
export const SHARE_TTL_MS = 10 * 60 * 1000;

export type ShareNotice = 'EMPTY' | 'TRUNCATED' | 'URL_DROPPED';

export const SHARE_NOTICE_MESSAGES: Record<ShareNotice, string> = {
  EMPTY: 'No recibimos contenido para compartir.',
  TRUNCATED: 'Lo compartido era muy largo y se recortó. Revisa el texto antes de interpretarlo.',
  URL_DROPPED: 'Se omitió un enlace que no era http ni https.',
};

export interface SharedInput {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

export interface ComposedShare {
  /** The text for the capture box ('' when nothing usable was shared). */
  text: string;
  /** Things the student must be told (never silent): cut content, a dropped link, nothing received. */
  notices: ShareNotice[];
}

/** Line breaks become \n and control characters (NUL, escapes…) are removed; tabs and newlines stay. */
function clean(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c >= 32;
    })
    .join('')
    .trim();
}

/** Only an http(s) link is kept; anything else (javascript:, data:, custom schemes, junk) is never carried. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (raw === '' || /\s/.test(raw)) return null;
  // Core has no DOM types (no `URL`): an http(s) scheme followed by a host, nothing else is carried.
  return /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(raw) ? raw : null;
}

const cut = (value: string, max: number, flag: { truncated: boolean }) => {
  if (value.length <= max) return value;
  flag.truncated = true;
  return value.slice(0, max).trimEnd();
};

/**
 * title, text and url -> one natural text: the title only when it adds something, the text, then the link (once). Too long is
 * cut at an explicit limit and reported, never silently.
 */
export function composeSharedText(input: SharedInput): ComposedShare {
  const flag = { truncated: false };
  const notices: ShareNotice[] = [];
  const title = cut(clean(input.title), SHARE_LIMITS.title, flag);
  const text = cut(clean(input.text), SHARE_LIMITS.text, flag);
  const rawUrl = clean(input.url);
  let url: string | null = null;
  if (rawUrl !== '') {
    if (rawUrl.length > SHARE_LIMITS.url) {
      flag.truncated = true; // a cut link is a wrong link: it is left out, and the student is told
    } else {
      url = safeHttpUrl(rawUrl);
      if (url === null) notices.push('URL_DROPPED');
    }
  }

  const lower = (s: string) => s.toLowerCase();
  const parts: string[] = [];
  if (title !== '' && !lower(text).includes(lower(title))) parts.push(title);
  if (text !== '') parts.push(text);
  if (url !== null && !text.includes(url) && !title.includes(url)) parts.push(url);

  let joined = parts.join('\n');
  const max = CAPTURE_MAX_LENGTH.QUICK;
  if (joined.length > max) {
    joined = joined.slice(0, max).trimEnd();
    flag.truncated = true;
  }
  if (flag.truncated) notices.push('TRUNCATED');
  if (joined === '') return { text: '', notices: ['EMPTY'] };
  return { text: joined, notices };
}

/**
 * A place to return to after logging in: only an internal path of this app. Rejects absolute URLs, protocol-relative ones
 * (//host), other schemes (javascript:, data:), backslashes and control characters. Returns null when it is not safe.
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127 || ch === '\\') return null;
  }
  // /\host and /%5chost variants resolve to another origin in some browsers.
  if (/%5c|%2f%2f/i.test(value.split('?')[0]!)) return null;
  return value;
}
