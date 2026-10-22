import { BACKPACK_PATHS, BODY_PATHS, FACES, FILL, GRID, pathsOfRects } from './pixelArt';
import { COMPANION_COPY, type CompanionState } from './companionState';

/**
 * Pixel Companion (V1): a small original character that sits beside the Home's greeting and says ONE short, neutral line about
 * the academic moment. It is decoration plus text: the picture is hidden from assistive technology (the line already says it),
 * nothing here is a button, a link or focusable, and it keeps no state.
 *
 * Motion is a quiet extra, never the message: every animation class is `motion-safe:`, so with "reduce motion" it is a still
 * picture, and the line carries the meaning on its own.
 */
const IDLE: Record<CompanionState, string> = {
  CALM: 'motion-safe:animate-companion-idle',
  FOCUSED: '',
  BUSY: 'motion-safe:animate-companion-bustle',
  REST: '',
};
/** Eyes blink only while focused or calm; asleep-looking REST and busy stay as they are. */
const BLINK: Record<CompanionState, string> = {
  CALM: '',
  FOCUSED: 'motion-safe:animate-companion-blink',
  BUSY: '',
  REST: '',
};

function Paths({ paths }: { paths: Record<string, string> }) {
  return (
    <>
      {Object.entries(paths).map(([color, d]) => (
        <path key={color} d={d} className={FILL[color]} />
      ))}
    </>
  );
}

export function PixelCompanion({
  state,
  nextLine,
}: {
  state: CompanionState;
  /** The next item, as a sentence, when it is clearly known (the Home decides). */
  nextLine?: string | null;
}) {
  // An unknown state never breaks the Home: it falls back to the neutral one.
  const known: CompanionState = state in FACES ? state : 'CALM';
  const face = FACES[known];
  return (
    <div
      data-companion={known}
      className="flex w-fit max-w-full items-center gap-3 rounded-2xl border border-border bg-accent-soft/70 py-2 pr-4 pl-3 sm:gap-4 sm:pl-4 lg:gap-5"
    >
      <svg
        viewBox={`0 0 ${GRID} ${GRID}`}
        aria-hidden="true"
        focusable="false"
        shapeRendering="crispEdges"
        className="size-16 shrink-0 sm:size-[4.5rem] lg:size-24"
      >
        <g className={IDLE[known]}>
          <Paths paths={BODY_PATHS} />
          <Paths paths={BACKPACK_PATHS} />
          <g className={`origin-center [transform-box:fill-box] ${BLINK[known]}`}>
            <Paths paths={pathsOfRects(face.eyes)} />
          </g>
          <Paths paths={pathsOfRects(face.rest)} />
        </g>
      </svg>
      <div className="min-w-0">
        <p className="text-base font-medium text-foreground">{COMPANION_COPY[known]}</p>
        {nextLine && <p className="text-sm break-words text-muted-foreground">{nextLine}</p>}
      </div>
    </div>
  );
}
