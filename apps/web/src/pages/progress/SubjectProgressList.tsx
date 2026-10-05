import type { Progress } from '@planner/core';
import { ProgressBar } from './ProgressBar';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Progress of the registered activities of each subject, in alphabetical order (stable and neutral: it does not
 * rank subjects by how well they are going). A subject with no activities says so instead of showing 0 %.
 */
export function SubjectProgressList({ subjects }: { subjects: Progress['subjects'] }) {
  return (
    <ul className="flex flex-col gap-2">
      {subjects.map((s) => (
        <li
          key={s.id}
          className="flex min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white"
        >
          <span
            aria-hidden="true"
            style={{ backgroundColor: s.color }}
            className="w-1.5 shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
            <p className="font-medium break-words">{s.name}</p>
            {s.total === 0 ? (
              <p className="text-sm text-slate-700">Sin actividades registradas</p>
            ) : (
              <>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-semibold">
                    {s.completed} de {s.total} completadas
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{s.percentage}%</span>
                </p>
                <ProgressBar
                  percent={s.percentage}
                  label={`Progreso de ${s.name}`}
                  valueText={`${s.percentage}%, ${s.completed} de ${s.total} actividades completadas`}
                />
                <p className="text-sm text-slate-700">
                  {plural(s.pending, 'pendiente', 'pendientes')} ·{' '}
                  {plural(s.inProgress, 'en proceso', 'en proceso')}
                  {s.overdue > 0 && (
                    <>
                      {' '}
                      ·{' '}
                      <span className="font-medium">
                        {plural(s.overdue, 'vencida', 'vencidas')}
                      </span>
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
