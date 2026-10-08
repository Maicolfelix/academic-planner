import type { RadarStatus } from '@planner/core';

// The same hues the Radar badges and rows already use, so a category looks the same on every screen. Each has a soft
// halo of its own color around the dot.
const DOT: Record<RadarStatus, string> = {
  OVERDUE: 'bg-red-800 [--halo:rgb(153_27_27/0.22)]',
  IMMEDIATE: 'bg-red-500 [--halo:rgb(239_68_68/0.22)]',
  UPCOMING: 'bg-orange-500 [--halo:rgb(249_115_22/0.22)]',
  PLANNABLE: 'bg-yellow-500 [--halo:rgb(234_179_8/0.25)]',
  UNDER_CONTROL: 'bg-green-600 [--halo:rgb(22_163_74/0.22)]',
};

/**
 * A small round mark for a Radar category. Decoration only: the category's NAME is always written next to it.
 * Inside a `group` it grows a little under a pointer; `beacon` sends one ripple, once (the single thing that needs
 * attention).
 */
export function RadarDot({ status, beacon = false }: { status: RadarStatus; beacon?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ring-2 ring-white shadow-[0_0_0_5px_var(--halo)] transition-transform duration-(--duration-fast) ease-spring group-hover:scale-125 ${DOT[status]} ${beacon ? 'animate-beacon' : ''}`}
    />
  );
}
