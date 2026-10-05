import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  type AcademicInboxProposal,
  type Subject,
} from '@planner/core';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/SelectField';
import { humanDate } from '../quickCapture/QuickCapturePreview';

/** What the student can correct before creating: the same fields of a manual activity. */
export interface ProposalDraft {
  title: string;
  subjectId: string;
  type: string;
  dueDate: string;
  dueTime: string;
}

export interface ProposalCardState {
  proposal: AcademicInboxProposal;
  draft: ProposalDraft;
  selected: boolean;
  discarded: boolean;
  status: 'idle' | 'creating' | 'created' | 'error';
  error?: string;
  errors: Record<string, string[]>;
}

interface Props {
  index: number;
  card: ProposalCardState;
  subjects: Subject[];
  onChange: (patch: Partial<ProposalDraft>) => void;
  onSelect: (selected: boolean) => void;
  onDiscard: () => void;
}

export const missingOf = (d: ProposalDraft) =>
  [
    d.title.trim() === '' && 'el título',
    d.subjectId === '' && 'la asignatura',
    d.dueDate === '' && 'la fecha',
  ].filter(Boolean) as string[];

/** One editable proposal. Nothing here is saved: only "Crear seleccionadas" creates activities. */
export function ProposalCard({ index, card, subjects, onChange, onSelect, onDiscard }: Props) {
  const { proposal: p, draft, status } = card;
  const id = `inbox-${index}`;
  const locked = status === 'created' || status === 'creating';
  const missing = missingOf(draft);
  const candidates = p.ambiguities[0]?.candidates ?? [];
  const notes = p.warnings.filter((w) => w.code !== 'POSSIBLE_DUPLICATE');
  const duplicate = p.warnings.find((w) => w.code === 'POSSIBLE_DUPLICATE');
  const describedBy = p.warnings.length > 0 ? `${id}-warnings` : undefined;

  return (
    <li>
      <article
        aria-labelledby={`${id}-title`}
        aria-describedby={describedBy}
        className={`flex flex-col gap-3 rounded-lg border-2 bg-white p-4 ${
          status === 'created' ? 'border-green-700' : 'border-slate-900'
        }`}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-title`} className="text-base font-semibold break-words">
            Propuesta {index + 1}: {draft.title || 'Sin título'}
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">
            {status === 'created'
              ? 'Creada'
              : missing.length > 0
                ? 'Incompleta'
                : 'Lista para revisar'}
          </span>
        </header>

        <p className="text-sm text-slate-700 break-words">
          Texto detectado: <span className="font-medium">“{p.rawSegment}”</span>
        </p>

        {p.warnings.length > 0 && (
          <ul
            id={`${id}-warnings`}
            className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950"
          >
            {duplicate && <li>{duplicate.message}</li>}
            {notes.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
          </ul>
        )}

        {status === 'error' && card.error && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {card.error}
          </p>
        )}

        {status === 'created' ? (
          <p role="status" className="text-sm text-green-900">
            Actividad creada: {draft.title}.
          </p>
        ) : (
          <>
            <FormField
              id={`${id}-title-input`}
              label="Título"
              value={draft.title}
              onChange={(title) => onChange({ title })}
              error={card.errors.title?.[0]}
            />

            {candidates.length > 0 && (
              <fieldset className="flex flex-col gap-2 rounded-md border border-slate-300 p-3">
                <legend className="px-1 text-sm font-medium">¿A cuál te refieres?</legend>
                {candidates.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-2 text-base">
                    <input
                      type="radio"
                      name={`${id}-candidate`}
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
              id={`${id}-subject`}
              label="Asignatura"
              placeholder="Elige una asignatura"
              value={draft.subjectId}
              onChange={(subjectId) => onChange({ subjectId })}
              options={subjects.map((s) => ({ value: s.id, label: s.name }))}
              error={card.errors.subjectId?.[0]}
            />
            <SelectField
              id={`${id}-type`}
              label="Tipo"
              value={draft.type}
              onChange={(type) => onChange({ type })}
              options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
              error={card.errors.type?.[0]}
            />
            <FormField
              id={`${id}-date`}
              label="Fecha"
              type="date"
              value={draft.dueDate}
              onChange={(dueDate) => onChange({ dueDate })}
              error={card.errors.dueDate?.[0]}
              hint={draft.dueDate ? humanDate(draft.dueDate) : undefined}
            />
            <FormField
              id={`${id}-time`}
              label="Hora (opcional)"
              type="time"
              value={draft.dueTime}
              onChange={(dueTime) => onChange({ dueTime })}
              error={card.errors.dueTime?.[0]}
              hint="Sin hora, vence al terminar el día."
            />

            {missing.length > 0 && (
              <p className="text-sm text-slate-700">Para crearla falta {missing.join(', ')}.</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={card.selected}
                  disabled={locked}
                  onChange={(e) => onSelect(e.target.checked)}
                  className="size-5"
                />
                Incluir en “Crear seleccionadas”
              </label>
              <button
                type="button"
                onClick={onDiscard}
                disabled={locked}
                className="min-h-11 rounded-md border border-slate-400 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                Descartar
              </button>
            </div>
          </>
        )}
      </article>
    </li>
  );
}
