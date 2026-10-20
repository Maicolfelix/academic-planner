import {
  ACTIVITY_TYPE_LABELS,
  WEEKDAY_LABELS,
  formatDateOnly,
  weekdayOf,
  type IcsParseResponse,
} from '@planner/core';
import {
  NO_SUBJECT,
  isWeekly,
  pendingOf,
  subjectPatch,
  subjectValue,
  type ReviewRow,
  type RowKind,
} from '../../icsImport/icsReviewModel';

const button =
  'min-h-11 rounded-md border border-slate-400 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const field =
  'min-h-11 w-full min-w-0 rounded-md border border-slate-400 bg-white px-3 py-2 text-base';

/** "07:00" -> "7:00 a. m." (hours on screen are always 12 h). */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

const REVIEW_LABEL: Record<string, string> = {
  title: 'Falta el título.',
  subject: 'Elige la asignatura.',
  endTime: 'Falta una hora de fin válida.',
  time: 'Falta la hora de inicio.',
  exceptions: 'Este evento tiene fechas excluidas: decide qué hacer.',
};

export function IcsRowCard({
  row,
  subjects,
  disabled,
  onPatch,
  onKind,
  onRemove,
}: {
  row: ReviewRow;
  subjects: IcsParseResponse['subjects'];
  disabled: boolean;
  onPatch: (change: Partial<ReviewRow>) => void;
  onKind: (kind: RowKind) => void;
  onRemove: () => void;
}) {
  const p = row.proposal;
  const id = `ics-${p.clientId}`;
  const unsupported = p.kindProposal === 'UNSUPPORTED';
  const pending = pendingOf(row);
  const when = p.date
    ? `${p.repeats === 'WEEKLY' ? `Cada ${WEEKDAY_LABELS[weekdayOf(p.date)].toLowerCase()}` : formatDateOnly(p.date)}${
        p.allDay ? ', todo el día' : p.startTime ? `, ${clock(p.startTime)}` : ''
      }${row.kind === 'BLOCK' && row.endTime ? ` – ${clock(row.endTime)}` : ''}`
    : 'Sin fecha válida';

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-white p-3">
      <div className="flex items-start gap-3">
        <input
          id={`${id}-selected`}
          type="checkbox"
          checked={row.selected && row.kind !== 'SKIP'}
          disabled={disabled || unsupported || row.kind === 'SKIP'}
          onChange={(e) => onPatch({ selected: e.target.checked })}
          className="mt-1 size-6 shrink-0"
          aria-label={`Importar ${row.title || p.sourceTitle}`}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{p.sourceTitle || 'Sin título'}</p>
          <p className="text-sm text-slate-700">{when}</p>
          {p.exceptions > 0 && (
            <p className="text-sm text-slate-700">Con {p.exceptions} fecha(s) excluida(s).</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Quitar ${p.sourceTitle || 'evento'} de la revisión`}
          className={`${button} shrink-0`}
        >
          Quitar
        </button>
      </div>

      {unsupported && (
        <p className="rounded-md bg-slate-100 p-2 text-sm text-slate-800">
          No se puede importar: {p.reason}
        </p>
      )}

      {p.warnings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950">
          {p.warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      )}

      {!unsupported && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-kind`} className="text-sm font-medium">
              Tipo
            </label>
            <select
              id={`${id}-kind`}
              value={row.kind}
              disabled={disabled}
              onChange={(e) => onKind(e.target.value as RowKind)}
              className={field}
            >
              <option value="ACTIVITY">Actividad</option>
              <option value="BLOCK">Clase / horario</option>
              <option value="SKIP">No importar</option>
            </select>
          </div>

          {row.kind !== 'SKIP' && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-title`} className="text-sm font-medium">
                  Título
                </label>
                <input
                  id={`${id}-title`}
                  value={row.title}
                  disabled={disabled}
                  onChange={(e) => onPatch({ title: e.target.value })}
                  className={field}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-subject`} className="text-sm font-medium">
                  Asignatura
                  {row.kind === 'ACTIVITY' ? ' (opcional)' : ''}
                </label>
                <select
                  id={`${id}-subject`}
                  value={subjectValue(row)}
                  disabled={disabled}
                  onChange={(e) => onPatch(subjectPatch(e.target.value))}
                  className={field}
                >
                  {(row.kind === 'BLOCK' || p.subject.kind === 'AMBIGUOUS') && (
                    <option value="">Elige una asignatura</option>
                  )}
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.studyName ? `${s.name} · ${s.studyName}` : s.name}
                    </option>
                  ))}
                  {row.kind === 'ACTIVITY' && (
                    <option value={NO_SUBJECT}>Importar sin asignatura</option>
                  )}
                </select>
              </div>
              {row.kind === 'ACTIVITY' && (
                <p className="text-sm text-slate-700">{ACTIVITY_TYPE_LABELS[p.type]}</p>
              )}
              {row.kind === 'BLOCK' && (
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-end`} className="text-sm font-medium">
                    Hora de fin
                  </label>
                  <input
                    id={`${id}-end`}
                    type="time"
                    value={row.endTime}
                    disabled={disabled}
                    onChange={(e) => onPatch({ endTime: e.target.value })}
                    className={field}
                  />
                </div>
              )}
              {row.kind === 'BLOCK' && p.exceptions > 0 && p.repeats === 'WEEKLY' && (
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-sm font-medium">
                    Este evento excluye {p.exceptions} fecha(s) y Academic Planner no las guarda
                  </legend>
                  {(
                    [
                      ['SERIES', 'Importar toda la serie (incluye las fechas excluidas)'],
                      ['SINGLE', 'Importar solo la primera clase, sin repetición'],
                      ['SKIP', 'No importar este evento'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${id}-exceptions`}
                        checked={row.exceptionChoice === value}
                        disabled={disabled}
                        onChange={() => onPatch({ exceptionChoice: value })}
                        className="size-5"
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}
              {row.kind === 'BLOCK' && !isWeekly(row) && p.repeats === 'WEEKLY' && (
                <p className="text-sm text-slate-700">Se creará una sola clase.</p>
              )}
            </>
          )}
        </div>
      )}

      {row.selected && pending.length > 0 && (
        <p className="text-sm text-amber-900">{pending.map((k) => REVIEW_LABEL[k]).join(' ')}</p>
      )}
      {row.error && (
        <p role="alert" className="text-sm text-red-700">
          {row.error}
        </p>
      )}
    </li>
  );
}
