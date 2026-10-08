import type { RadarStatus } from '@planner/core';

// The same hues the Radar badges and rows already use, so a category looks the same on every screen. `--halo` is the
// soft ring around the dot (always there); `--glow` is the stronger light of the ambient ring.
const DOT: Record<RadarStatus, string> = {
  OVERDUE: 'bg-red-800 [--halo:rgb(153_27_27/0.22)] [--glow:rgb(220_38_38/0.55)]',
  IMMEDIATE: 'bg-red-500 [--halo:rgb(239_68_68/0.22)] [--glow:rgb(239_68_68/0.5)]',
  UPCOMING: 'bg-orange-500 [--halo:rgb(249_115_22/0.22)] [--glow:rgb(249_115_22/0.45)]',
  PLANNABLE: 'bg-yellow-500 [--halo:rgb(234_179_8/0.25)] [--glow:rgb(234_179_8/0.4)]',
  UNDER_CONTROL: 'bg-green-600 [--halo:rgb(22_163_74/0.22)] [--glow:rgb(22_163_74/0.35)]',
};

/**
 * How often a state's mark breathes (seconds). The graver the state, the closer and stronger the rhythm; the calm
 * ones are slow and faint. Each cycle is mostly rest (see `halo` in index.css).
 */
export const AMBIENT_PERIOD: Record<RadarStatus, number> = {
  OVERDUE: 4.5,
  IMMEDIATE: 5.5,
  UPCOMING: 7,
  PLANNABLE: 8.5,
  UNDER_CONTROL: 10,
};

/**
 * A small round mark for a Radar category. Decoration only: the category's NAME is always written next to it.
 * Inside a `group` it grows a little under a pointer; `beacon` sends one ripple, once (the single thing that needs
 * attention). `ambient` (a position in a row) makes it breathe a ring now and then, out of step with its neighbours:
 * the Radar is "watching". With reduced motion the ring never starts, and nothing depends on it: the state is a word.
 */
export function RadarDot({
  status,
  beacon = false,
  ambient,
}: {
  status: RadarStatus;
  beacon?: boolean;
  ambient?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block size-2.5 shrink-0 rounded-full ring-2 ring-white shadow-[0_0_0_5px_var(--halo)] transition-transform duration-(--duration-fast) ease-spring group-hover:scale-125 ${DOT[status]} ${beacon ? 'animate-beacon' : ''}`}
    >
      {ambient !== undefined && (
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-(--glow) opacity-0 motion-safe:animate-halo"
          style={{
            animationDuration: `${AMBIENT_PERIOD[status]}s`,
            animationDelay: `${((ambient * 1.7) % AMBIENT_PERIOD[status]).toFixed(1)}s`,
          }}
        />
      )}
    </span>
  );
}
