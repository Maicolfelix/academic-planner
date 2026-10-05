import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';

/**
 * Progress of the activities registered in this period (finished / total). It is not performance,
 * grades or knowledge, and the card says so. CSS only: no chart library.
 */
export function ProgressCard({ progress }: { progress: Dashboard['progress'] }) {
  const { percent, completed, total } = progress;
  const text = `${completed} de ${total} actividades finalizadas`;

  return (
    <section
      aria-labelledby="progress-title"
      className="flex flex-col gap-2 rounded-lg border border-slate-300 p-4"
    >
      <h2 id="progress-title" className="text-lg font-semibold">
        Progreso de actividades
      </h2>
      <p className="text-3xl font-semibold">{percent}%</p>
      <div
        role="progressbar"
        aria-label="Progreso de actividades"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, ${text}`}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div style={{ width: `${percent}%` }} className="h-full rounded-full bg-slate-900" />
      </div>
      <p>{text}</p>
      <p className="text-sm text-slate-600">
        Mide solo las actividades que has registrado en este periodo.
      </p>
      <Link
        to="/progress"
        className="inline-flex min-h-11 items-center self-start text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        Ver progreso por asignatura
      </Link>
    </section>
  );
}
