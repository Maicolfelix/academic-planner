export const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró. Inicia sesión nuevamente.';

const KEY = 'planner.sessionExpired';

// sessionStorage can be unavailable (private windows, blocked storage): fall back to memory.
let memory = false;

/** Remembers that the server ended the session, so the login screen can say why. */
export function markSessionExpired() {
  memory = true;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* memory is enough */
  }
}

export function sessionExpiredPending(): boolean {
  try {
    return memory || sessionStorage.getItem(KEY) === '1';
  } catch {
    return memory;
  }
}

export function clearSessionExpired() {
  memory = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
