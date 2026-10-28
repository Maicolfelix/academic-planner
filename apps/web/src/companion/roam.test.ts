import { describe, expect, it } from 'vitest';
import { completedLine, greetingLine, nextStop, touchLine, walkSeconds } from './roam';

describe('nextStop', () => {
  it('always lands inside the lane and at least a quarter of it away', () => {
    for (const current of [0, 40, 100, 160, 200])
      for (let i = 0; i <= 20; i++) {
        const t = nextStop(current, 200, i / 20);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(200);
        expect(Math.abs(t - current)).toBeGreaterThanOrEqual(50);
      }
  });

  it('survives an empty or tiny lane and wild random values', () => {
    expect(nextStop(0, 0, 0.5)).toBe(0);
    expect(nextStop(5, -3, 0.5)).toBe(0);
    expect(nextStop(10, 200, 7)).toBeLessThanOrEqual(200);
    expect(nextStop(10, 200, -2)).toBeGreaterThanOrEqual(0);
  });
});

describe('walkSeconds', () => {
  it('is calm: slower for longer walks, never below 1.2 s', () => {
    expect(walkSeconds(0)).toBe(1.2);
    expect(walkSeconds(36)).toBe(1.2);
    expect(walkSeconds(-360)).toBe(10);
  });
});

describe('the words it says', () => {
  it('greets by time of day', () => {
    expect(greetingLine(8)).toContain('Buenos días');
    expect(greetingLine(15)).toContain('Buenas tardes');
    expect(greetingLine(22)).toContain('Buenas noches');
    expect(greetingLine(2)).toContain('Buenas noches');
  });

  it('rotates its touch lines and brings the overdue one first', () => {
    const calm = new Set(Array.from({ length: 10 }, (_, n) => touchLine(n, 0)));
    expect(calm.size).toBe(5);
    expect(touchLine(0, 2)).toContain('atrasado');
    expect(touchLine(0, 0)).not.toContain('atrasado');
    expect(touchLine(-1, 0)).toBeTruthy();
  });

  it('never orders, blames or counts: no imperatives, no streaks, no points', () => {
    const all = [
      ...Array.from({ length: 12 }, (_, n) => touchLine(n, 1)),
      ...Array.from({ length: 6 }, (_, n) => completedLine(n)),
      greetingLine(9),
    ].join(' ');
    expect(all).not.toMatch(
      /\b(debes|tienes que|deberías|no olvides|rápido|racha|puntos|nivel)\b/i,
    );
  });
});
