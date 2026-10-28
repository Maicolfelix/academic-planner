import {
  ARM_PATHS,
  BACKPACK_PATHS,
  BODY_PATHS,
  CHEEK_PATHS,
  EXTRA_PATHS,
  FACES,
  FILL,
  GRID,
  SHADOW_PATHS,
  POSE_FACES,
  TUFT_PATHS,
  pathsOfRects,
  type CompanionPose,
} from './pixelArt';
import { COMPANION_COPY, type CompanionState } from './companionState';

/**
 * Pixel Companion (C1): a small original character that sits beside the Home's greeting and says ONE short, neutral line about
 * the academic moment. It is decoration plus text: the picture is hidden from assistive technology (the line already says it),
 * nothing here is a button, a link or focusable, and it keeps no state.
 *
 * It is alive in small ways: it hops in and waves hello once, breathes, blinks, glances around and its tuft sways. Each mood
 * adds one thing of its own (sparkles when calm, a nod when focused, a drop of sweat when busy, floating Zs when resting).
 *
 * Motion is a quiet extra, never the message: every animation class is `motion-safe:`, so with "reduce motion" it is a still
 * picture, and the line carries the meaning on its own. All of it moves in whole logical pixels, with `steps()`, so it stays
 * pixel art; only transform and opacity change.
 */
/* Full class names on purpose: Tailwind finds classes by scanning the source text, so they must never be assembled. */
/** The body's own rhythm, one per mood. */
const IDLE: Record<CompanionState, string> = {
  CALM: 'motion-safe:animate-companion-idle',
  FOCUSED: 'motion-safe:animate-companion-nod',
  BUSY: 'motion-safe:animate-companion-bustle',
  REST: 'motion-safe:animate-companion-sleep',
};
/** Awake moods blink, glance around (calm only), sway the tuft and wave hello once; REST is asleep and does none of it. */
const awake = (state: CompanionState, c: string) => (state === 'REST' ? '' : c);

function Paths({ paths }: { paths: Record<string, string> }) {
  return (
    <>
      {Object.entries(paths).map(([color, d]) => (
        <path key={color} d={d} className={FILL[color]} />
      ))}
    </>
  );
}

/** What each mood adds on top of the character: one small, quiet thing. */
function Extras({ state }: { state: CompanionState }) {
  if (state === 'CALM')
    return (
      <>
        <g className={'motion-safe:animate-companion-twinkle'}>
          <Paths paths={EXTRA_PATHS.sparkle} />
        </g>
        <g className={'motion-safe:animate-companion-twinkle [animation-delay:-1.6s]'}>
          <Paths paths={EXTRA_PATHS.sparkleSmall} />
        </g>
      </>
    );
  if (state === 'REST')
    return (
      <>
        <g className={'motion-safe:animate-companion-float'}>
          <Paths paths={EXTRA_PATHS.zBig} />
        </g>
        <g className={'motion-safe:animate-companion-float [animation-delay:-2s]'}>
          <Paths paths={EXTRA_PATHS.zSmall} />
        </g>
      </>
    );
  if (state === 'BUSY')
    return (
      <g className={'motion-safe:animate-companion-drip'}>
        <Paths paths={EXTRA_PATHS.drop} />
      </g>
    );
  return null;
}

/** The picture alone (decorative): the Home card and the roaming companion both draw it. `walking` swaps the mood's rhythm for a step. */
export function CompanionSprite({
  state,
  className = 'size-16 shrink-0 sm:size-[4.5rem] lg:size-24',
  walking = false,
  pose,
}: {
  state: CompanionState;
  className?: string;
  walking?: boolean;
  /** Acts a moment out (covering its eyes, joy, worry) instead of showing the state's face. */
  pose?: CompanionPose;
}) {
  // An unknown state never breaks the Home: it falls back to the neutral one.
  const known: CompanionState = state in FACES ? state : 'CALM';
  const posed = pose && pose in POSE_FACES ? pose : undefined;
  const face = posed ? POSE_FACES[posed] : FACES[known];
  // Only the poses that carry a mood bring its small extra (a pose that hides the face brings none).
  const extras: CompanionState | null =
    posed === 'joy' ? 'CALM' : posed === 'worried' ? 'BUSY' : posed === 'cover' ? null : known;
  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className={className}
    >
      <g className="opacity-15">
        <Paths paths={SHADOW_PATHS} />
      </g>
      <g className={'motion-safe:animate-companion-hop'}>
        <g className={walking ? 'motion-safe:animate-companion-walk' : IDLE[known]}>
          <Paths paths={BODY_PATHS} />
          <Paths paths={BACKPACK_PATHS} />
          <Paths paths={CHEEK_PATHS} />
          <g className={awake(known, 'motion-safe:animate-companion-sway')}>
            <Paths paths={TUFT_PATHS} />
          </g>
          {/* The greeting wave belongs to a plain arrival; a pose holds its arm still (raised in joy). */}
          <g transform={posed === 'joy' ? 'translate(0 -5)' : undefined}>
            <g className={posed ? '' : awake(known, 'motion-safe:animate-companion-wave')}>
              <Paths paths={ARM_PATHS} />
            </g>
          </g>
          <g className={known === 'CALM' ? 'motion-safe:animate-companion-look' : ''}>
            <g
              className={`origin-center [transform-box:fill-box] ${awake(known, 'motion-safe:animate-companion-blink')}`}
            >
              <Paths paths={pathsOfRects(face.eyes)} />
            </g>
          </g>
          <Paths paths={pathsOfRects(face.rest)} />
        </g>
        {extras && <Extras state={extras} />}
      </g>
    </svg>
  );
}

export function PixelCompanion({
  state,
  nextLine,
}: {
  state: CompanionState;
  /** One more line under the state (the Home decides; today it is the next class of the day). Never an activity: the hero says that. */
  nextLine?: string | null;
}) {
  // An unknown state never breaks the Home: it falls back to the neutral one.
  const known: CompanionState = state in FACES ? state : 'CALM';
  return (
    <div
      data-companion={known}
      className="flex w-fit max-w-full items-center gap-3 rounded-2xl border border-border bg-accent-soft/70 py-2 pr-4 pl-3 sm:gap-4 sm:pl-4 lg:gap-5"
    >
      <CompanionSprite state={known} />
      <div className="min-w-0">
        <p className="text-base font-medium text-foreground">{COMPANION_COPY[known]}</p>
        {nextLine && <p className="text-sm break-words text-muted-foreground">{nextLine}</p>}
      </div>
    </div>
  );
}
