import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';

/**
 * A ring that draws itself once: the same value as the bar below, as a shape. Decoration (the percentage is text beside
 * it and the progressbar carries the value). Paint-only animation on one small SVG.
 */
function Ring({ percent }: { percent: number }) {
  const done = percent === 100;
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
      className="size-20 shrink-0 -rotate-90"
    >
      <defs>
        <linearGradient id="progress-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={done ? '#067647' : '#0d9488'} />
          <stop offset="100%" stopColor={done ? '#0d9488' : '#4f46e5'} />
        </linearGradient>
      </defs>
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        strokeWidth="3.2"
        className="stroke-secondary"
      />
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        strokeWidth="3.2"
        stroke="url(#progress-ring)"
        strokeLinecap={percent > 0 ? 'round' : 'butt'}
        strokeDasharray={`${percent} 100`}
        pathLength={100}
        className="animate-ring"
      />
    </svg>
  );
}

/**
 * Progress of the activities registered in this period (finished / total). It is not performance,
 * grades or knowledge, and the card says so. CSS and one small SVG: no chart library. When the card appears the
 * number pops in, the ring draws itself, the bar fills to its value once and one glint crosses it; with reduced motion
 * it simply is at its value, with no delay. A screen reader gets the exact value at once (the progressbar's own
 * attributes). At 100 % the surface takes a done tint (derived from the same number, nothing stored).
 */
export function ProgressCard({ progress }: { progress: Dashboard['progress'] }) {
  const { percent, completed, total } = progress;
  const text = `${completed} de ${total} actividades finalizadas`;
  const done = percent === 100 && total > 0;

  return (
    <Card
      as="section"
      variant={done ? 'success' : 'tinted'}
      aria-labelledby="progress-title"
      className="flex flex-col gap-3 p-4"
    >
      <h2
        id="progress-title"
        className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Progreso de actividades
      </h2>
      <div className="flex items-center gap-4">
        <Ring percent={percent} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="animate-pop text-4xl leading-none font-semibold text-primary [animation-delay:120ms]">
            {percent}%
          </p>
          <p>{text}</p>
        </div>
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
          className={`relative h-full origin-left animate-fill overflow-hidden rounded-full ${
            done
              ? 'bg-[linear-gradient(90deg,var(--success),var(--accent))]'
              : 'bg-[linear-gradient(90deg,var(--accent),#4f46e5)]'
          }`}
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
