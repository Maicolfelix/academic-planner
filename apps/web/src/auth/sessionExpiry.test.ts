import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionExpired, markSessionExpired, sessionExpiredPending } from './sessionExpiry';

// The unit tests run in Node: there is no sessionStorage, which is exactly the "blocked storage" case.
describe('session expiry marker', () => {
  beforeEach(clearSessionExpired);

  it('starts clear, remembers an expiry and can be cleared', () => {
    expect(sessionExpiredPending()).toBe(false);
    markSessionExpired();
    expect(sessionExpiredPending()).toBe(true);
    clearSessionExpired();
    expect(sessionExpiredPending()).toBe(false);
  });
});
