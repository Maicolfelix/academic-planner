import {
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  formatDateOnly,
  formatDuration,
  type Weekday,
  type Workload,
} from '@planner/core';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Counts of the week in plain words: "2 entregas pendientes · 6 clases · 3 sesiones de estudio". */
export function totalsLine(t: Workload['totals']): string {
  return [
    plural(t.openActivityCount, 'entrega pendiente', 'entregas pendientes'),
    plural(t.classCount, 'clase', 'clases'),
    plural(t.studyBlockCount, 'sesión de estudio', 'sesiones de estudio'),
    ...(t.otherAcademicBlockCount > 0
      ? [plural(t.otherAcademicBlockCount, 'otro bloque académico', 'otros bloques académicos')]
      : []),
  ].join(' · ');
}

export const busiestText = (b: NonNullable<Workload['busiestDay']>) =>
  `${WEEKDAY_LABELS[b.weekday as Weekday]} — ${b.totalCommitments}`;

/**
 * The week as seven small bars plus a day-by-day list. The bars are decorative: every day also has its number and
 * its sentence in text, so nothing depends on the height or the color of a bar. Seven narrow columns fit a 360 px
 * phone without horizontal scrolling.
 */
export function WorkloadDetail({ workload }: { workload: Workload }) {
  const max = Math.max(1, ...workload.days.map((d) => d.totalCommitments));
  const busiest = workload.busiestDay?.date;

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Compromisos por día" className="grid grid-cols-7 gap-1.5">
        {workload.days.map((d) => (
          <li key={d.date} className="flex min-w-0 flex-col items-center gap-1">
            <span className="sr-only">
              {WEEKDAY_LABELS[d.weekday as Weekday]}:{' '}
              {plural(d.totalCommitments, 'compromiso', 'compromisos')}
            </span>
            <span aria-hidden="true" className="text-sm font-semibold">
              {d.totalCommitments}
            </span>
            <span aria-hidden="true" className="flex h-16 w-full items-end rounded bg-slate-100">
              <span
                style={{ height: `${(d.totalCommitments / max) * 100}%` }}
                className={`w-full rounded ${d.date === busiest ? 'bg-slate-900' : 'bg-slate-500'}`}
              />
            </span>
            <span aria-hidden="true" className="text-xs">
              {WEEKDAY_SHORT_LABELS[d.weekday as Weekday]}
            </span>
          </li>
        ))}
      </ul>

      <ul aria-label="Detalle por día" className="flex flex-col gap-1.5">
        {workload.days.map((d) => (
          <li
            key={d.date}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">
                {WEEKDAY_LABELS[d.weekday as Weekday]} {formatDateOnly(d.date)}
              </span>
              {d.date === busiest && (
                <span className="rounded-full border border-slate-900 px-2 text-xs font-medium">
                  Día con más compromisos
                </span>
              )}
            </p>
            {d.totalCommitments === 0 ? (
              <p className="text-slate-700">Sin compromisos registrados</p>
            ) : (
              <p className="text-slate-700">
                {plural(d.activityCount, 'actividad', 'actividades')} ·{' '}
                {plural(d.scheduleCount, 'bloque de agenda', 'bloques de agenda')}
                {d.scheduledMinutes > 0 && (
                  <> · {formatDuration(d.scheduledMinutes)} programadas</>
                )}{' '}
                ·{' '}
                <span className="font-medium">
                  {plural(d.totalCommitments, 'compromiso', 'compromisos')}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
