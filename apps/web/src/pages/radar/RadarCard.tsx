import { QueryError } from '../../components/QueryError';
import { RADAR_GROUP_LABELS, RADAR_KEYS, RADAR_STATUSES, type Radar } from '@planner/core';
import { Link } from 'react-router';
import { useRadar } from '../../radar/useRadar';
import { RadarDot } from './RadarDot';

/**
 * Compact Home summary of the Radar: the five categories as small tiles (three and two on a phone, five in a row
 * from `sm`). Each tile is a link to the Activities list filtered by that category; the name and the count are
 * always text. The detail lives in /radar. (The Radar screen keeps its own, taller rows: `RadarSummary`.)
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

function RadarGlance({ summary }: { summary: Radar['summary'] }) {
  return (
    <ul className="grid grid-cols-6 gap-2 sm:grid-cols-5">
      {RADAR_STATUSES.map((status, i) => (
        <li key={status} className={`${i < 3 ? 'col-span-2' : 'col-span-3'} sm:col-span-1`}>
          <Link
            to={`/activities?radar=${status}`}
            className="flex min-h-16 flex-col justify-between gap-1 rounded-surface border border-border bg-surface px-3 py-2 shadow-card transition-[transform,background-color] duration-(--duration-fast) ease-standard hover:bg-secondary active:scale-[0.98]"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <RadarDot status={status} />
              <span>{RADAR_GROUP_LABELS[status]}</span>
            </span>
            <span className="text-xl leading-none font-semibold">
              {summary[RADAR_KEYS[status]]}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
