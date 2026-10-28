import { useSyncExternalStore } from 'react';

/**
 * Does the student want the roaming companion? A per-device convenience (like a remembered tab), so it lives in
 * `localStorage`, never on the server; a blocked or empty storage just means "yes, show it".
 */
const KEY = 'planner.companion.hidden';
const CHANGED = 'planner:companion-hidden';

export function readCompanionHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCompanionHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useCompanionHidden(): boolean {
  return useSyncExternalStore(subscribe, readCompanionHidden, () => false);
}
