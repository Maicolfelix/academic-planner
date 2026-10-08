import { QueryError } from '../../components/QueryError';
import { RADAR_LABELS, formatDue, radarExplanation, type RadarStatus } from '@planner/core';
import { Link } from 'react-router';
import { useAttention } from '../../attention/useAttention';
import { Card } from '../../components/ui/Card';
import { PriorityBadge, StatusBadge } from '../activities/badges';
import { RadarDot } from '../radar/RadarDot';

/** Calm, neutral wording: it orients, the student decides. No alarm, no blame, no orders. */
const INTRO: Record<RadarStatus, string> = {
  OVERDUE: 'Tienes actividades vencidas. Esta es la que actualmente requiere mayor atención.',
  IMMEDIATE: 'Actividad que requiere mayor atención.',
  UPCOMING: 'Actividad que requiere mayor atención.',
  PLANNABLE: 'Actividad que requiere mayor atención.',
  UNDER_CONTROL: 'Todo está bajo control. Si quieres avanzar, podrías continuar con:',
};

/**
 * "¿Qué hago ahora?": ONE suggested activity and the plain reasons behind it. The internal score is never
 * shown, and neither are the alternatives the API returns (the full list lives in Activities).
 * It is the one hero of the Home: the only deep surface on the screen.
 */
export function AttentionCard({ timeZone, now }: { timeZone: string; now: Date }) {
  const attention = useAttention();

  return (
    <section aria-labelledby="attention-title" className="flex animate-rise flex-col gap-2">
      <h2 id="attention-title" className="text-section-title">
        ¿Qué hago ahora?
      </h2>

      {attention.isPending && <p role="status">Buscando qué actividad requiere atención…</p>}

      <QueryError query={attention} title="No se pudo cargar la sugerencia" />

      {attention.data && !attention.data.recommendation && (
        <Card variant="dashed" className="p-4">
          No tienes actividades pendientes en este momento.
        </Card>
      )}

      {attention.data?.recommendation && (
        <Suggestion item={attention.data.recommendation} timeZone={timeZone} now={now} />
      )}
    </section>
  );
}

export function Suggestion({
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
      className="flex flex-col gap-4 rounded-hero bg-primary p-5 text-primary-foreground shadow-hero"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {/* The state is a word with a mark, never a color on its own. */}
        <span className="mr-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium">
          <RadarDot status={radarStatus} />
          {RADAR_LABELS[radarStatus]}
        </span>
        <PriorityBadge priority={activity.priority} />
        <StatusBadge status={activity.status} />
      </div>

      <div className="min-w-0">
        <p id="attention-activity" className="text-2xl leading-tight font-semibold break-words">
          {activity.title}
        </p>
        <p className="mt-0.5 text-primary-foreground/80 break-words">{activity.subject.name}</p>
      </div>

      <p className="text-lg">
        {formatDue(activity, timeZone)}
        <span aria-hidden="true"> · </span>
        <span className="font-semibold">{radarExplanation(activity, now, timeZone)}</span>
      </p>

      <div className="flex flex-col gap-2 text-sm text-primary-foreground/85">
        <p>{INTRO[radarStatus]}</p>
        <div>
          <p id="attention-why" className="font-semibold text-primary-foreground">
            ¿Por qué esta?
          </p>
          <ul aria-labelledby="attention-why" className="mt-1 list-disc pl-5">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* A white button on the deep surface; its focus ring is white too, the page's dark ring would vanish here. */}
      <Link
        to={`/activities?edit=${activity.id}`}
        aria-label={`Ver actividad: ${activity.title}`}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-control bg-white px-4 py-2 text-sm font-semibold text-primary transition-[transform,background-color] duration-(--duration-fast) ease-standard hover:bg-accent-soft focus-visible:outline-white active:scale-[0.98]"
      >
        Ver actividad
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
