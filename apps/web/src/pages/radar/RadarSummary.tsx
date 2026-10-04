import {
  RADAR_GROUP_LABELS,
  RADAR_KEYS,
  RADAR_STATUSES,
  RADAR_SYMBOLS,
  type Radar,
} from '@planner/core';
import { Link } from 'react-router';

const ROW_STYLE = {
  OVERDUE: 'border-l-red-800',
  IMMEDIATE: 'border-l-red-500',
  UPCOMING: 'border-l-orange-500',
  PLANNABLE: 'border-l-yellow-600',
  UNDER_CONTROL: 'border-l-green-600',
} as const;

/**
 * The five categories as a compact vertical list (also on a 360 px phone). Each row is a link to the
 * Activities list filtered by that category; the count and the name are always text.
 */
export function RadarSummary({ summary }: { summary: Radar['summary'] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {RADAR_STATUSES.map((status) => (
        <li key={status}>
          <Link
            to={`/activities?radar=${status}`}
            className={`flex min-h-11 items-center justify-between gap-3 rounded-md border border-l-4 border-slate-300 ${ROW_STYLE[status]} bg-white px-3 py-2 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
          >
            <span>
              <span aria-hidden="true">{RADAR_SYMBOLS[status]} </span>
              <span>{RADAR_GROUP_LABELS[status]}</span>
            </span>
            <span className="text-lg font-semibold">{summary[RADAR_KEYS[status]]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
