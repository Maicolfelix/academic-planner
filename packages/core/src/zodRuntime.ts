import { z } from 'zod';

/**
 * In a BROWSER, Zod must not try to compile validators with `new Function`: our Content-Security-Policy forbids
 * 'unsafe-eval', so the attempt is blocked, reported as a violation and abandoned. Declaring `jitless` up front
 * gives the same behaviour with no violation. On the server (no `document`) the faster compiled path stays on.
 * This runs before any schema of this package is built because `index.ts` imports it first.
 */
if ('document' in globalThis) z.config({ jitless: true });
