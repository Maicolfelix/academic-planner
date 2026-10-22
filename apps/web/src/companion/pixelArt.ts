import type { CompanionState } from './companionState';

/**
 * The companion's pixel art, as data. A 24 x 24 logical grid drawn with plain SVG paths (one per color), so the edges stay crisp
 * at any size (`shape-rendering: crispEdges`), nothing is a bitmap and nothing is fetched. The body, the backpack and the feet
 * are shared by every state; a state only changes the face (eyes, brows, mouth) and one small detail.
 *
 * Letters: O outline, B body, L belly, K backpack, P paper. The colors are the app's own tokens (see PixelCompanion).
 */
export const GRID = 24;

const BODY = [
  '........................', // 0
  '........................', // 1
  '...........OO...........', // 2  a small tuft
  '........OOOOOOOO........', // 3
  '......OOBBBBBBBBOO......', // 4
  '.....OBBBBBBBBBBBBO.....', // 5
  '....OBBBBBBBBBBBBBBO....', // 6
  '....OBBBBBBBBBBBBBBO....', // 7
  '....OBBBBBBBBBBBBBBO....', // 8
  '....OBBBBBBBBBBBBBBO....', // 9
  '....OBBBBBBBBBBBBBBO....', // 10
  '....OBBBBBBBBBBBBBBO....', // 11
  '....OBBBBBBBBBBBBBBO....', // 12
  '....OBBBBBBBBBBBBBBO....', // 13
  '....OBBBBLLLLLLBBBBO....', // 14  a small light belly, apart from the mouth
  '....OBBBBLLLLLLBBBBO....', // 15
  '.....OBBBBBBBBBBBBO.....', // 16
  '.....OBBBBBBBBBBBBO.....', // 17
  '......OOBBBBBBBBOO......', // 18
  '.......OOOOOOOOOO.......', // 19
  '......OOO......OOO......', // 20
  '......OOO......OOO......', // 21
  '........................', // 22
  '........................', // 23
];

/**
 * A backpack on the left (the academic detail): bigger than before, with a top handle, a pocket line and a strap that crosses
 * the shoulder onto the body, so it reads as a school bag at a glance. Drawn over the body.
 */
const BACKPACK: Rect[] = [
  [1, 7, 2, 1, 'O'], // handle
  [1, 8, 3, 1, 'O'], // top
  [0, 9, 1, 7, 'O'], // back edge
  [1, 9, 3, 7, 'K'], // bag
  [1, 13, 3, 1, 'O'], // pocket line
  [1, 16, 3, 1, 'O'], // bottom
  [5, 8, 2, 1, 'K'], // strap over the shoulder...
  [6, 9, 1, 6, 'K'], // ...and down the front
];

type Rect = [x: number, y: number, w: number, h: number, color: string];

const EYES_OPEN: Rect[] = [
  [8, 8, 2, 3, 'O'],
  [14, 8, 2, 3, 'O'],
];
const EYES_SMALL: Rect[] = [
  [8, 9, 2, 2, 'O'],
  [14, 9, 2, 2, 'O'],
];
const EYES_CLOSED: Rect[] = [
  [8, 10, 2, 1, 'O'],
  [14, 10, 2, 1, 'O'],
];
const SMILE: Rect[] = [
  [10, 11, 1, 1, 'O'],
  [13, 11, 1, 1, 'O'],
  [11, 12, 2, 1, 'O'],
];
const MOUTH_FLAT: Rect[] = [[11, 12, 2, 1, 'O']];
const BROWS_FLAT: Rect[] = [
  [8, 7, 2, 1, 'O'],
  [14, 7, 2, 1, 'O'],
];
/** A few loose pages next to the character (only when several things are close). */
const PAPERS: Rect[] = [
  [20, 8, 3, 1, 'O'],
  [20, 9, 3, 3, 'P'],
  [20, 12, 3, 1, 'O'],
  [19, 6, 2, 1, 'O'],
  [19, 7, 2, 1, 'P'],
];

export interface Face {
  /** Eyes get their own group so a blink can move only them. */
  eyes: Rect[];
  rest: Rect[];
}

/** One face per state: 1-2 pixels of difference, the structure is shared. */
export const FACES: Record<CompanionState, Face> = {
  CALM: { eyes: EYES_OPEN, rest: SMILE },
  FOCUSED: { eyes: EYES_SMALL, rest: [...BROWS_FLAT, ...MOUTH_FLAT] },
  BUSY: { eyes: EYES_OPEN, rest: [...MOUTH_FLAT, ...PAPERS] },
  REST: { eyes: EYES_CLOSED, rest: SMILE },
};

/** Run-length merges the letters of the grid into one path per color: "M x y h w v 1 h -w z" per horizontal run. */
export function pathsOfGrid(rows: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      let end = x;
      while (end + 1 < row.length && row[end + 1] === c) end++;
      if (c !== '.') out[c] = `${out[c] ?? ''}M${x} ${y}h${end - x + 1}v1h-${end - x + 1}z`;
      x = end + 1;
    }
  });
  return out;
}

export function pathsOfRects(rects: readonly Rect[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [x, y, w, h, c] of rects) out[c] = `${out[c] ?? ''}M${x} ${y}h${w}v${h}h-${w}z`;
  return out;
}

export const BODY_PATHS = pathsOfGrid(BODY);
export const BACKPACK_PATHS = pathsOfRects(BACKPACK);

/** Letter -> the token class that fills it. Only the app's own colors. */
export const FILL: Record<string, string> = {
  O: 'fill-primary',
  B: 'fill-accent',
  L: 'fill-accent-soft',
  K: 'fill-info',
  P: 'fill-surface',
};
