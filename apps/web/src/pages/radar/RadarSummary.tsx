import {
  RADAR_GROUP_LABELS,
  RADAR_KEYS,
  RADAR_STATUSES,
  RADAR_SYMBOLS,
  type Radar,
  type RadarStatus,
} from '@planner/core';
import { Link } from 'react-router';

/** The hue of each category: a bar across the top of its tile and a soft light behind the number. */
const HUE: Record<RadarStatus, { bar: string; glow: string }> = {
  OVERDUE: { bar: 'bg-red-800', glow: 'rgb(153 27 27 / 0.14)' },
  IMMEDIATE: { bar: 'bg-red-500', glow: 'rgb(239 68 68 / 0.14)' },
  UPCOMING: { bar: 'bg-orange-500', glow: 'rgb(249 115 22 / 0.14)' },
  PLANNABLE: { bar: 'bg-yellow-500', glow: 'rgb(234 179 8 / 0.16)' },
  UNDER_CONTROL: { bar: 'bg-green-600', glow: 'rgb(22 163 74 / 0.14)' },
};

/**
 * The five categories as tiles (two columns on a 360 px phone, three from `sm`): a bar of the category's hue across the
 * top, a soft light of the same hue behind a big number and the name under it. Each tile is a link to the Activities list
 * filtered by that category; the count and the name are always text, the bar and the light are decoration. The tiles
 * rise one after another.
 */
export function RadarSummary({ summary }: { summary: Radar['summary'] }) {
  return (
    <ul className="stagger grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {RADAR_STATUSES.map((status) => {
        const count = summary[RADAR_KEYS[status]];
        return (
          <li key={status}>
            <Link
              to={`/activities?radar=${status}`}
              style={{
                backgroundImage: `radial-gradient(90% 90% at 100% 0%, ${HUE[status].glow}, transparent 70%)`,
              }}
              className="group relative flex min-h-24 flex-col justify-between gap-2 overflow-hidden rounded-surface border border-border bg-surface px-3.5 pt-4 pb-3 shadow-card transition-[transform,box-shadow] duration-(--duration-normal) ease-spring hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-1 ${HUE[status].bar}`}
              />
              <span
                className={`text-4xl leading-none font-semibold tracking-tight tabular-nums ${count === 0 ? 'text-muted-foreground' : ''}`}
              >
                {count}
              </span>
              <span className="text-sm font-medium">
                <span aria-hidden="true">{RADAR_SYMBOLS[status]} </span>
                {RADAR_GROUP_LABELS[status]}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
