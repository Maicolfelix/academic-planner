import { describe, expect, it } from 'vitest';
import { achievementFor, STREAK_WINDOW_MS, withinWindow } from './achievementModel';

describe('achievements', () => {
  it('names the first, the second and the longer streaks', () => {
    expect(achievementFor(1)).toBe('Actividad completada');
    expect(achievementFor(2)).toBe('¡Doble! Dos seguidas');
    expect(achievementFor(5)).toBe('¡Racha de 5!');
  });

  it('only counts what was finished inside the window', () => {
    const now = 10 * STREAK_WINDOW_MS;
    expect(withinWindow([], now)).toEqual([now]);
    expect(withinWindow([now - 1000, now - STREAK_WINDOW_MS - 1], now)).toEqual([now - 1000, now]);
  });
});
