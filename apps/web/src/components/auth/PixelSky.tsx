/**
 * The night behind the sign-in screens, in the same pixel language as the companion: stars that take turns to twinkle and a small
 * moon. Every "pixel" is a few CSS pixels wide and the same size on any screen (a stretched grid would turn into giant blocks on a
 * tall desktop panel). Decoration only: hidden from assistive technology, and every twinkle is `motion-safe:` (with "reduce
 * motion" it is a still sky).
 */
// [left %, top %, group]: three groups twinkle out of step. The top-left corner stays clear: the brand and the tagline live there.
const STARS: [number, number, 0 | 1 | 2][] = [
  [64, 14, 0],
  [14, 34, 1],
  [80, 8, 2],
  [58, 24, 0],
  [38, 46, 2],
  [93, 40, 1],
  [56, 30, 0],
  [63, 6, 2],
  [71, 40, 1],
  [79, 18, 0],
  [86, 52, 2],
  [92, 28, 1],
  [10, 58, 2],
  [27, 64, 0],
  [52, 62, 1],
  [75, 70, 2],
  [90, 74, 0],
  [18, 80, 1],
];
const GROUP = [
  'motion-safe:animate-companion-star',
  'motion-safe:animate-companion-star [animation-delay:-1.1s]',
  'motion-safe:animate-companion-star [animation-delay:-2.2s]',
];
// A few brighter, plus-shaped stars.
const PLUS: [number, number, 0 | 1 | 2][] = [
  [74, 34, 1],
  [44, 36, 2],
  [68, 22, 0],
  [84, 62, 1],
];

export function PixelSky({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`}>
      {STARS.map(([x, y, g]) => (
        <span
          key={`${x}-${y}`}
          style={{ left: `${x}%`, top: `${y}%` }}
          className={`absolute size-1 bg-white/80 lg:size-1.5 ${GROUP[g]}`}
        />
      ))}
      {PLUS.map(([x, y, g]) => (
        <svg
          key={`p${x}-${y}`}
          viewBox="0 0 3 3"
          aria-hidden="true"
          shapeRendering="crispEdges"
          focusable="false"
          style={{ left: `${x}%`, top: `${y}%` }}
          className={`absolute size-3 fill-white/70 lg:size-[1.125rem] ${GROUP[g]}`}
        >
          <path d="M1 0h1v3h-1zM0 1h3v1h-3z" />
        </svg>
      ))}
      {/* the moon, facing left */}
      <svg
        viewBox="0 0 6 8"
        aria-hidden="true"
        shapeRendering="crispEdges"
        focusable="false"
        className="absolute top-[12%] right-[9%] h-8 w-6 fill-white/90 lg:h-[3.5rem] lg:w-[2.625rem]"
      >
        <path d="M2 0h3v1h-3zM1 1h2v1h-2zM0 2h2v3h-2zM1 5h2v1h-2zM2 6h3v1h-3z" />
      </svg>
    </div>
  );
}
