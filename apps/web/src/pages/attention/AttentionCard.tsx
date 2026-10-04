import { formatDue, radarExplanation, type RadarStatus } from '@planner/core';
import { Link } from 'react-router';
import { useAttention } from '../../attention/useAttention';
import { PriorityBadge, StatusBadge } from '../activities/badges';
import { RadarBadge } from '../radar/RadarBadge';

/** Calm, neutral wording: it orients, the student decides. No alarm, no blame, no orders. */
const INTRO: Record<RadarStatus, string> = {
  OVERDUE: 'Tienes actividades vencidas. Esta es la que actualmente requiere mayor atención.',
  IMMEDIATE: 'Actividad que requiere mayor atención.',
  UPCOMING: 'Actividad que requiere mayor atención.',
  PLANNABLE: 'Actividad que requiere mayor atención.',
  UNDER_CONTROL: 'Todo está bajo control. Si quieres avanzar, podrías continuar con:',
};

const secondary =
  'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100';

/**
 * "¿Qué hago ahora?": ONE suggested activity and the plain reasons behind it. The internal score is never
 * shown, and neither are the alternatives the API returns (the full list lives in Activities).
 */
export function AttentionCard({ timeZone, now }: { timeZone: string; now: Date }) {
  const attention = useAttention();

  return (
    <section aria-labelledby="attention-title" className="flex flex-col gap-2">
      <h2 id="attention-title" className="text-lg font-semibold">
        ¿Qué hago ahora?
      </h2>

      {attention.isPending && <p role="status">Buscando qué actividad requiere atención…</p>}

      {attention.isError && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-2">No se pudo cargar la sugerencia: {attention.error.message}</p>
          <button type="button" onClick={() => attention.refetch()} className={secondary}>
            Reintentar
          </button>
        </div>
      )}

      {attention.data && !attention.data.recommendation && (
        <p className="rounded-lg border border-dashed border-slate-300 p-4">
          No tienes actividades pendientes en este momento.
        </p>
      )}

      {attention.data?.recommendation && (
        <Suggestion item={attention.data.recommendation} timeZone={timeZone} now={now} />
      )}
    </section>
  );
}

function Suggestion({
  item,
  timeZone,
  now,
}: {
  item: NonNullable<ReturnType<typeof useAttention>['data']>['recommendation'] & object;
  timeZone: string;
  now: Date;
}) {
  const { activity, radarStatus, reasons } = item;
  return (
    <article
      aria-labelledby="attention-activity"
      className="flex flex-col gap-3 rounded-lg border-2 border-slate-900 bg-white p-4"
    >
      <p className="text-sm text-slate-700">{INTRO[radarStatus]}</p>

      <div className="min-w-0">
        <p id="attention-activity" className="text-xl font-semibold break-words">
          {activity.title}
        </p>
        <p className="text-sm text-slate-700 break-words">{activity.subject.name}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <RadarBadge status={radarStatus} />
        <PriorityBadge priority={activity.priority} />
        <StatusBadge status={activity.status} />
      </div>

      <p className="text-sm text-slate-700">
        {formatDue(activity, timeZone)}
        <span aria-hidden="true"> · </span>
        <span className="font-medium">{radarExplanation(activity, now, timeZone)}</span>
      </p>

      <div>
        <p id="attention-why" className="text-sm font-semibold">
          ¿Por qué esta?
        </p>
        <ul aria-labelledby="attention-why" className="mt-1 list-disc pl-5 text-sm">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <Link
        to={`/activities?edit=${activity.id}`}
        aria-label={`Ver actividad: ${activity.title}`}
        className="inline-flex min-h-11 items-center self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        Ver actividad
      </Link>
    </article>
  );
}
