/**
 * The same kind of tiny in-page signal as the companion's: whoever finishes an activity says so, and the achievement card (if it
 * is on screen) listens. It keeps nothing: an event reaches whoever listens right now, or is lost.
 */
export interface AchievementEvent {
  /** The title of the activity that was finished. */
  title: string;
}

const listeners = new Set<(event: AchievementEvent) => void>();

export function emitAchievement(event: AchievementEvent): void {
  for (const listener of listeners) listener(event);
}

export function onAchievement(listener: (event: AchievementEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
