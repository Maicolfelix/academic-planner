import { RADAR_LABELS, type RadarStatus } from '@planner/core';
import { RadarDot } from './RadarDot';

// The same tones as the Radar tiles of the Home, so a category looks the same on every screen. Soft background plus dark
// ink keeps the contrast high without relying on the hue; the one exception is "Vencidas", a solid red: the strongest
// signal, for something that already passed. The mark is a `RadarDot` (the language of the Home), never an emoji, and the
// NAME of the category is always text next to it.
const TONE: Record<RadarStatus, string> = {
  OVERDUE: 'border-danger bg-danger text-primary-foreground',
  IMMEDIATE: 'border-danger-line bg-danger-soft text-danger-ink',
  UPCOMING: 'border-warning-line bg-warning-soft text-warning-ink',
  PLANNABLE: 'border-warning-line bg-warning-soft text-warning-ink',
  UNDER_CONTROL: 'border-success-line bg-success-soft text-success-ink',
};

/**
 * The Radar category of an open activity. Never rendered for a finished one (it has no category). A static mark:
 * a list can hold dozens of these, so nothing here animates (the breathing ring is for the few marks of the Home).
 */
export function RadarBadge({ status }: { status: RadarStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
    >
      <RadarDot status={status} compact />
      <span className="sr-only">Radar </span>
      <span>{RADAR_LABELS[status]}</span>
    </span>
  );
}
