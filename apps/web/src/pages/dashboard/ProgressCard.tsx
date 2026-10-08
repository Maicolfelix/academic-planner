import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';

/**
 * Progress of the activities registered in this period (finished / total). It is not performance,
 * grades or knowledge, and the card says so. CSS only: no chart library. When the card appears the number pops in,
 * the bar fills to its value once and one glint crosses it; with reduced motion it simply is at its value, with no
 * delay. A screen reader gets the exact value at once (the progressbar's own attributes).
 */
export function ProgressCard({ progress }: { progress: Dashboard['progress'] }) {
  const { percent, completed, total } = progress;
  const text = `${completed} de ${total} actividades finalizadas`;

  return (
    <Card as="section" aria-labelledby="progress-title" className="flex flex-col gap-3 p-4">
      <h2
        id="progress-title"
        className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Progreso de actividades
      </h2>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="animate-pop text-4xl leading-none font-semibold text-primary [animation-delay:120ms]">
          {percent}%
        </p>
        <p>{text}</p>
      </div>
      <div
        role="progressbar"
        aria-label="Progreso de actividades"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, ${text}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          style={{ width: `${percent}%` }}
          className="relative h-full origin-left animate-fill overflow-hidden rounded-full bg-accent"
        >
          {/* The glint: a soft light that crosses the fill once, after it has grown. Decoration. */}
          {percent > 0 && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1/4 animate-glint bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.55),transparent)]"
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <p className="text-xs text-muted-foreground">
          Mide solo las actividades que has registrado en este periodo.
        </p>
        <Link
          to="/progress"
          className="inline-flex min-h-11 items-center text-sm font-medium text-accent-ink underline underline-offset-4"
        >
          Ver progreso por asignatura
        </Link>
      </div>
    </Card>
  );
}
