/**
 * The roaming companion's small decisions, as pure functions (no clock, no randomness of their own: the caller passes both),
 * so they are easy to test. Copy rule of the project: it describes, it never orders and it never blames; it is "here with
 * you", not "you should".
 */

/** Where to walk next along a lane `max` px wide: somewhere else, at least a quarter of the lane away. */
export function nextStop(current: number, max: number, rand: number): number {
  if (!(max > 0)) return 0;
  const minStep = max / 4;
  const r = Math.min(Math.max(rand, 0), 1);
  // Two stretches are far enough: [0, current - minStep] on the left and [current + minStep, max] on the right.
  const leftLen = Math.max(0, current - minStep);
  const rightStart = current + minStep;
  const rightLen = Math.max(0, max - rightStart);
  const room = leftLen + rightLen;
  if (room <= 0) return current > max / 2 ? 0 : max;
  const pick = r * room;
  return Math.round(
    pick < leftLen || rightLen === 0 ? Math.min(pick, leftLen) : rightStart + (pick - leftLen),
  );
}

/** Seconds a walk takes at a calm pace (never faster than 1.2 s so short steps still read as walking). */
export function walkSeconds(distancePx: number, pxPerSecond = 36): number {
  return Math.max(1.2, Math.abs(distancePx) / pxPerSecond);
}

export function greetingLine(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buenos días. Aquí estoy.';
  if (hour >= 12 && hour < 19) return 'Buenas tardes. Aquí estoy.';
  return 'Buenas noches. Aquí estoy.';
}

const TOUCH = [
  'Aquí estoy.',
  'Vamos a tu ritmo.',
  'Una cosa a la vez.',
  'Si algo se complica, lo vemos por partes.',
  'Estoy pendiente de ti.',
];
const OVERDUE = 'Hay algo atrasado. Sin presión: cuando quieras lo vemos.';
const COMPLETED = ['Listo, una menos.', 'Eso ya está.', 'Una cosa menos en la lista.'];

/** The line for the nth tap: it rotates, and when something is overdue that line comes up first, once per round. */
export function touchLine(n: number, overdue: number): string {
  const lines = overdue > 0 ? [OVERDUE, ...TOUCH] : TOUCH;
  return lines[((n % lines.length) + lines.length) % lines.length]!;
}

export function completedLine(n: number): string {
  return COMPLETED[((n % COMPLETED.length) + COMPLETED.length) % COMPLETED.length]!;
}
