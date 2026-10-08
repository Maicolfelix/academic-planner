import { QueryError } from '../../components/QueryError';
import {
  RADAR_GROUP_LABELS,
  RADAR_KEYS,
  RADAR_STATUSES,
  type Radar,
  type RadarStatus,
} from '@planner/core';
import { Link } from 'react-router';
import { useRadar } from '../../radar/useRadar';
import { Card } from '../../components/ui/Card';
import { INTERACTIVE_TILE } from '../../components/ui/interactive';
import { RadarDot } from './RadarDot';

/** The color of a category's segment in the strip: the same hue as its dot. */
const SEGMENT: Record<RadarStatus, string> = {
  OVERDUE: 'bg-red-800',
  IMMEDIATE: 'bg-red-500',
  UPCOMING: 'bg-orange-500',
  PLANNABLE: 'bg-yellow-500',
  UNDER_CONTROL: 'bg-green-600',
};

/** A category that has something to show takes a soft tint of its own hue; one at zero goes quiet. The label is text. */
const TONE: Record<RadarStatus, string> = {
  OVERDUE: 'border-danger-line bg-danger-soft text-danger-ink',
  IMMEDIATE: 'border-danger-line bg-danger-soft text-danger-ink',
  UPCOMING: 'border-warning-line bg-warning-soft text-warning-ink',
  PLANNABLE: 'border-warning-line bg-warning-soft text-warning-ink',
  UNDER_CONTROL: 'border-success-line bg-success-soft text-success-ink',
};
const QUIET = 'border-transparent bg-transparent text-muted-foreground';

/**
 * Compact Home summary of the Radar: "the planner is watching your load". A live strip shows the proportion of
 * the five categories at a glance and, under it, each category is a tile (three and two on a phone, five in a row
 * from `sm`, one row each in the desktop side column). Each tile is a link to the Activities list filtered by that
 * category; the name and the count are always text. The strip is decoration. The detail lives in /radar. (The Radar
 * screen keeps its own, taller rows: `RadarSummary`.)
 */
export function RadarCard() {
  const radar = useRadar();

  return (
    <section aria-labelledby="radar-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="radar-title" className="text-section-title">
          Radar académico
        </h2>
        <Link
          to="/radar"
          className="inline-flex min-h-11 items-center text-sm font-medium text-accent-ink underline underline-offset-4"
        >
          Ver el Radar completo
        </Link>
      </div>
      {radar.isPending && <p role="status">Cargando Radar…</p>}
      <QueryError query={radar} title="No se pudo cargar el Radar" />
      {radar.data && <RadarGlance summary={radar.data.summary} />}
    </section>
  );
}

export function RadarGlance({ summary }: { summary: Radar['summary'] }) {
  return (
    <Card variant="tinted" className="flex animate-rise flex-col gap-3 p-3">
      {/* The spectrum: five segments as wide as their counts. It fills in once and, now and then, a faint light passes
          over it. Decoration: every number is also written in the tiles below. */}
      <div
        aria-hidden="true"
        className="relative flex h-2.5 origin-left animate-fill gap-0.5 overflow-hidden rounded-full bg-secondary [animation-delay:80ms]"
      >
        {RADAR_STATUSES.map((status) => {
          const count = summary[RADAR_KEYS[status]];
          return (
            <span
              key={status}
              className={`h-full rounded-full ${SEGMENT[status]}`}
              style={{ flexGrow: count, flexBasis: count > 0 ? '0.6rem' : 0 }}
            />
          );
        })}
        <span className="absolute inset-y-0 left-0 w-1/5 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.7),transparent)] motion-safe:animate-scan" />
      </div>

      <ul className="grid grid-cols-6 gap-2 sm:grid-cols-5 lg:grid-cols-1">
        {RADAR_STATUSES.map((status, i) => {
          const count = summary[RADAR_KEYS[status]];
          return (
            <li
              key={status}
              className={`animate-rise ${i < 3 ? 'col-span-2' : 'col-span-3'} sm:col-span-1 lg:col-span-1`}
              style={{ animationDelay: `${120 + i * 45}ms` }}
            >
              <Link
                to={`/activities?radar=${status}`}
                className={`group flex min-h-16 flex-col justify-between gap-1 rounded-surface border px-3 py-2 lg:min-h-11 lg:flex-row lg:items-center ${
                  count > 0 ? `${TONE[status]} shadow-card` : QUIET
                } ${INTERACTIVE_TILE}`}
              >
                <span className="flex items-center gap-2 text-xs font-medium lg:text-sm">
                  <RadarDot status={status} ambient={count > 0 ? i : undefined} />
                  <span>{RADAR_GROUP_LABELS[status]}</span>
                </span>
                <span className="text-xl leading-none font-semibold">{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
