import type { RadarStatus } from '@planner/core';

// The same hues the Radar badges and rows already use, so a category looks the same on every screen.
const DOT: Record<RadarStatus, string> = {
  OVERDUE: 'bg-red-800',
  IMMEDIATE: 'bg-red-500',
  UPCOMING: 'bg-orange-500',
  PLANNABLE: 'bg-yellow-500',
  UNDER_CONTROL: 'bg-green-600',
};

/** A small round mark for a Radar category. Decoration only: the category's NAME is always written next to it. */
export function RadarDot({ status }: { status: RadarStatus }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ring-2 ring-white ${DOT[status]}`}
    />
  );
}
