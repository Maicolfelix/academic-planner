/**
 * What the app says when an activity is finished. Nothing is stored and nothing is measured about the student: the label only
 * depends on how many activities were finished in the last few minutes IN THIS TAB (a lively word for a little streak), so a
 * second one soon after the first reads as a "doble", and so on. It never says anything about grades or performance.
 */
export const STREAK_WINDOW_MS = 10 * 60 * 1000;

/** The timestamps still inside the window, plus this one. */
export function withinWindow(times: number[], now: number): number[] {
  return [...times.filter((t) => now - t < STREAK_WINDOW_MS), now];
}

/** The achievement for the n-th activity finished inside the window (n >= 1). */
export function achievementFor(n: number): string {
  if (n <= 1) return 'Actividad completada';
  if (n === 2) return '¡Doble! Dos seguidas';
  return `¡Racha de ${n}!`;
}
