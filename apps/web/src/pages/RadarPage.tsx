import {
  DEFAULT_TIMEZONE,
  RADAR_GROUP_LABELS,
  RADAR_KEYS,
  RADAR_STATUSES,
  radarExplanation,
} from '@planner/core';
import { Link } from 'react-router';
import { useMe } from '../auth/useAuth';
import { QueryError } from '../components/QueryError';
import { useNow } from '../lib/useNow';
import { useRadar } from '../radar/useRadar';
import { DueSection } from './dashboard/DueSection';
import { RadarSummary } from './radar/RadarSummary';

/**
 * Radar académico: the open activities of the current period grouped by how much time is left. It is not a
 * priority list and does not say what to do first. Each group shows its first activities; the rest are one
 * click away in the Activities list filtered by the same category.
 */
export function RadarPage() {
  const radar = useRadar();
  const timeZone = useMe().data?.timezone ?? DEFAULT_TIMEZONE;
  const now = useNow();

  if (radar.isPending) return <p role="status">Cargando Radar…</p>;
  if (!radar.data) return <QueryError query={radar} title="No se pudo cargar el Radar" />;

  const { summary, groups, period } = radar.data;
  const open = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Radar académico</h1>
        {period && <p className="text-sm text-slate-600 break-words">{period.name}</p>}
        <p className="mt-1 text-sm text-slate-700">
          Ordena tus actividades abiertas según el tiempo que falta para cada fecha límite. No es
          prioridad ni una recomendación de qué hacer primero.
        </p>
      </header>

      <QueryError query={radar} title="No se pudo cargar el Radar" />

      <section aria-labelledby="radar-summary-title" className="flex flex-col gap-2">
        <h2 id="radar-summary-title" className="text-lg font-semibold">
          Resumen
        </h2>
        <RadarSummary summary={summary} />
      </section>

      {open === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          No tienes actividades abiertas en el periodo actual.
        </p>
      )}

      {RADAR_STATUSES.map((status) => {
        const key = RADAR_KEYS[status];
        const items = groups[key];
        if (items.length === 0) return null;
        const hidden = summary[key] - items.length;
        return (
          <DueSection
            key={status}
            title={`${RADAR_GROUP_LABELS[status]} (${summary[key]})`}
            items={items}
            timeZone={timeZone}
            now={now}
            overdue={status === 'OVERDUE'}
            describe={(a) => radarExplanation(a, now, timeZone)}
            footer={
              hidden > 0 && (
                <p className="text-sm">
                  + {hidden} más.{' '}
                  <Link to={`/activities?radar=${status}`} className="font-medium underline">
                    Ver todas en Actividades
                  </Link>
                </p>
              )
            }
          />
        );
      })}

      <p>
        <Link
          to="/dashboard"
          className="inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
