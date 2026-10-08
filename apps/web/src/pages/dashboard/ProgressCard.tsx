import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';

/**
 * Progress of the activities registered in this period (finished / total). It is not performance,
 * grades or knowledge, and the card says so. CSS only: no chart library. The bar fills to its value once, when
 * the card appears (`animate-fill`; with reduced motion it simply is at its value).
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
        <p className="text-4xl leading-none font-semibold text-primary">{percent}%</p>
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
          className="h-full origin-left animate-fill rounded-full bg-accent"
        />
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
