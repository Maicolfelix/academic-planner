import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  WEEKDAY_LABELS,
  weekdayOf,
  type QuickCaptureResult,
  type Subject,
} from '@planner/core';
import { forwardRef } from 'react';
import { Link } from 'react-router';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/SelectField';

/** What the student can correct before creating. These are the same fields of a manual activity. */
export interface QuickCaptureDraft {
  title: string;
  subjectId: string;
  type: string;
  dueDate: string;
  dueTime: string;
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "2026-10-06" -> "Martes 6 de octubre". Built from the string: no timezone can shift the day. */
export function humanDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  const weekday = WEEKDAY_LABELS[weekdayOf(date)];
  return `${weekday} ${d} de ${MONTHS[m - 1]}`;
}

const button =
  'min-h-11 rounded-md border border-slate-400 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

interface Props {
  capture: QuickCaptureResult;
  draft: QuickCaptureDraft;
  subjects: Subject[];
  /** Field errors from the Activity schema or the server, shown next to the field. */
  errors: Record<string, string[]>;
  formError?: string;
  pending: boolean;
  onChange: (patch: Partial<QuickCaptureDraft>) => void;
  onConfirm: () => void;
  onEditText: () => void;
  onCancel: () => void;
}

/**
 * The proposal, editable. Nothing here is saved: only "Crear actividad" creates an activity (through the normal
 * Activity API) and it stays disabled until title, subject and date are present.
 */
export const QuickCapturePreview = forwardRef<HTMLDivElement, Props>(function QuickCapturePreview(
  {
    capture,
    draft,
    subjects,
    errors,
    formError,
    pending,
    onChange,
    onConfirm,
    onEditText,
    onCancel,
  },
  ref,
) {
  const missing = [
    draft.title.trim() === '' && 'el título',
    draft.subjectId === '' && 'la asignatura',
    draft.dueDate === '' && 'la fecha',
  ].filter(Boolean);
  const candidates = capture.ambiguities[0]?.candidates ?? [];
  const typeLabel = (t: string) => ACTIVITY_TYPE_LABELS[t as keyof typeof ACTIVITY_TYPE_LABELS];

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Vista previa de la actividad"
      aria-describedby={capture.warnings.length > 0 ? 'quick-capture-warnings' : undefined}
      className="flex flex-col gap-4 rounded-lg border-2 border-slate-900 bg-white p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      <p className="text-sm text-slate-700 break-words">
        Interpreté: <span className="font-medium">“{capture.rawText.trim()}”</span>. Revisa los
        datos y corrígelos si hace falta; no se guarda nada hasta que pulses “Crear actividad”.
      </p>

      {capture.warnings.length > 0 && (
        <ul
          id="quick-capture-warnings"
          className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950"
        >
          {capture.warnings.map((w) => (
            <li key={w.code + w.message}>{w.message}</li>
          ))}
        </ul>
      )}

      {formError && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {formError}
        </p>
      )}

      <FormField
        id="quick-title"
        label="Título"
        value={draft.title}
        onChange={(title) => onChange({ title })}
        error={errors.title?.[0]}
      />

      {candidates.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-300 p-3">
          <legend className="px-1 text-sm font-medium">¿A cuál te refieres?</legend>
          {candidates.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-2 text-base">
              <input
                type="radio"
                name="quick-subject-candidate"
                value={c.id}
                checked={draft.subjectId === c.id}
                onChange={() => onChange({ subjectId: c.id })}
                className="size-5"
              />
              {c.name}
            </label>
          ))}
        </fieldset>
      )}

      <SelectField
        id="quick-subject"
        label="Asignatura"
        placeholder="Elige una asignatura"
        value={draft.subjectId}
        onChange={(subjectId) => onChange({ subjectId })}
        options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        error={errors.subjectId?.[0]}
      />

      <SelectField
        id="quick-type"
        label="Tipo"
        value={draft.type}
        onChange={(type) => onChange({ type })}
        options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
        error={errors.type?.[0]}
      />
      {capture.certainty.type === 'MISSING' && (
        <p className="-mt-3 text-sm text-slate-600">
          No reconocí el tipo: se propone {typeLabel(draft.type)}.
        </p>
      )}

      <FormField
        id="quick-date"
        label="Fecha"
        type="date"
        value={draft.dueDate}
        onChange={(dueDate) => onChange({ dueDate })}
        error={errors.dueDate?.[0]}
        hint={draft.dueDate ? humanDate(draft.dueDate) : undefined}
      />

      <FormField
        id="quick-time"
        label="Hora (opcional)"
        type="time"
        value={draft.dueTime}
        onChange={(dueTime) => onChange({ dueTime })}
        error={errors.dueTime?.[0]}
        hint="Sin hora, vence al terminar el día."
      />

      {missing.length > 0 && (
        <p className="text-sm text-slate-700">Para crearla falta {missing.join(', ')}.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending || missing.length > 0}
          className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {pending ? 'Creando…' : 'Crear actividad'}
        </button>
        <button type="button" onClick={onEditText} disabled={pending} className={button}>
          Volver a editar texto
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={button}>
          Cancelar
        </button>
      </div>

      <p className="text-sm">
        ¿Prefieres el formulario completo?{' '}
        <Link to="/activities?action=create" className="font-medium underline">
          Crear manualmente
        </Link>
      </p>
    </div>
  );
});
