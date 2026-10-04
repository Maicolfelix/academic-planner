import { RADAR_LABELS, RADAR_SYMBOLS, type RadarStatus } from '@planner/core';

// Pale background + dark text + border: contrast stays high without relying on the hue. The text label is
// always present (and the two reds differ in wording), so color is only a supporting cue.
export const RADAR_STYLE: Record<RadarStatus, string> = {
  OVERDUE: 'border-red-800 bg-red-800 text-white',
  IMMEDIATE: 'border-red-500 bg-red-50 text-red-950',
  UPCOMING: 'border-orange-500 bg-orange-50 text-orange-950',
  PLANNABLE: 'border-yellow-600 bg-yellow-50 text-yellow-950',
  UNDER_CONTROL: 'border-green-600 bg-green-50 text-green-950',
};

/** The Radar category of an open activity. Never rendered for a finished one (it has no category). */
export function RadarBadge({ status }: { status: RadarStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${RADAR_STYLE[status]}`}
    >
      <span aria-hidden="true">{RADAR_SYMBOLS[status]}</span>
      <span className="sr-only">Radar </span>
      <span>{RADAR_LABELS[status]}</span>
    </span>
  );
}
