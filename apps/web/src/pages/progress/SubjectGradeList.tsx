import { formatScore, type Progress } from '@planner/core';
import { Link } from 'react-router';
import type { OriginOf } from '../../academic/origin';
import { OriginLabel } from '../../components/OriginLabel';

type Row = Progress['subjects'][number];

/**
 * The academic grade of each subject that has its grades configured, APART from the progress of activities (they are two different
 * ideas and are never merged into one percentage). Data only, no judgement: what is accumulated, how many cuts have a grade and,
 * when something is graded, the average of what is registered. A subject with no scale or no cuts is simply not listed (never a 0.0).
 */
export function SubjectGradeList({ subjects, origin }: { subjects: Row[]; origin?: OriginOf }) {
  const rows = subjects.filter(
    (s): s is Row & { grade: NonNullable<Row['grade']> } => s.grade !== null,
  );
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="progress-grades-title" className="flex flex-col gap-2">
      <h3 id="progress-grades-title" className="text-lg font-semibold">
        Notas
      </h3>
      <p className="text-sm text-slate-700">
        Las notas son aparte del avance de actividades: no se mezclan en un mismo porcentaje.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((s) => {
          const g = s.grade;
          const max = formatScore(g.maxMilli, g.decimals);
          return (
            <li
              key={s.id}
              className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-300 bg-white p-3"
            >
              <p className="font-medium break-words">
                {s.name}
                <OriginLabel label={origin?.(s.periodId)} />
              </p>
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                {g.accumulatedMilli === null ? (
                  <span className="font-semibold">Sin notas todavía</span>
                ) : (
                  <span className="font-semibold">
                    {g.cutsWithGrade === g.cutsTotal ? '' : 'Acumulada '}
                    {formatScore(g.accumulatedMilli, g.decimals)} / {max}
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  {g.cutsWithGrade} de {g.cutsTotal} {g.cutsTotal === 1 ? 'corte' : 'cortes'} con
                  nota
                </span>
              </p>
              {g.currentMilli !== null && g.cutsWithGrade < g.cutsTotal && (
                <p className="text-sm text-slate-700">
                  Promedio de lo registrado: {formatScore(g.currentMilli, g.decimals)}
                </p>
              )}
              {!g.complete && (
                <p className="text-sm text-slate-700">Estimación: faltan pesos por definir.</p>
              )}
              <Link
                to={`/subjects/${s.id}/grades`}
                className="inline-flex min-h-11 items-center self-start text-sm font-medium underline"
              >
                Ver notas
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
