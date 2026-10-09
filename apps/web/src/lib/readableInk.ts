/** The neutral color of something that has no subject (a general activity, a block with no class): never a subject's own. */
export const NO_SUBJECT_COLOR = '#64748B';

/** Relative luminance of a `#RRGGBB` color (WCAG 2.x), or null when the text is not one. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const WHITE = '#ffffff';
// Darker than the page's foreground on purpose: it is what the light colors of the palette (yellow, orange) need.
// The monogram is LARGE bold text, so 3:1 is the bar (and most colors reach 4.5:1).
const INK = '#0b1030';

/** The text color (white or the app's ink) that reads best on a solid `#RRGGBB` background such as a subject's color. */
export function readableInk(background: string): string {
  const l = luminance(background);
  if (l === null) return WHITE;
  // White whenever it clears 3:1 (the bar for large bold text, which is what the monogram is): it looks the best on
  // the saturated colors. Only the light ones (yellow, orange…) need the dark ink.
  return 1.05 / (l + 0.05) >= 3 ? WHITE : INK;
}

/** A `#RRGGBB` color with an alpha (0–1), for a soft wash of a subject's color; unchanged if it is not `#RRGGBB`. */
export function withAlpha(hex: string, alpha: number): string {
  if (luminance(hex) === null) return hex;
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
