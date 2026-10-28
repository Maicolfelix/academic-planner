/**
 * A tiny in-page signal so the roaming companion can notice what the student just did without owning any of it. It carries no
 * data and keeps nothing: an event is delivered to whoever listens right now, or lost.
 */
export type CompanionEvent = 'completed';

const listeners = new Set<(event: CompanionEvent) => void>();

export function emitCompanion(event: CompanionEvent): void {
  for (const listener of listeners) listener(event);
}

export function onCompanion(listener: (event: CompanionEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
