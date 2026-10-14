import type { Progress } from '@planner/core';
import { ProgressBar } from './ProgressBar';

/**
 * The progress of each current period, one line per period (named after its study, or after the general period itself: so the
 * heading says "periodo", never "estudio"), under the overall one: two studies are
 * never shown as a single semester. It is a count of registered activities, not a grade; a period with none says so.
 */
export function ProgressByPeriod({ byPeriod }: { byPeriod: Progress['byPeriod'] }) {
  return (
    <section aria-labelledby="progress-by-period-title" className="flex flex-col gap-2">
      <h3 id="progress-by-period-title" className="text-lg font-semibold">
        Por periodo
      </h3>
      <ul className="flex flex-col gap-2">
        {byPeriod.map(({ period, studyTrack, general }) => {
          const name = studyTrack?.name ?? period.name;
          return (
            <li
              key={period.id}
              className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-300 bg-white p-3"
            >
              <p className="font-medium break-words">{name}</p>
              {general.total === 0 ? (
                <p className="text-sm text-slate-700">Sin actividades registradas</p>
              ) : (
                <>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold">
                      {general.completed} de {general.total} completadas
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{general.percentage}%</span>
                    {general.overdue > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium">
                          {general.overdue} {general.overdue === 1 ? 'vencida' : 'vencidas'}
                        </span>
                      </>
                    )}
                  </p>
                  <ProgressBar
                    percent={general.percentage}
                    label={`Progreso de ${name}`}
                    valueText={`${general.percentage}%, ${general.completed} de ${general.total} actividades completadas`}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
