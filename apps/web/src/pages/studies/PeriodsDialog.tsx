import {
  createPeriodSchema,
  fieldErrorsOf,
  formatDateOnly,
  STUDY_LEVEL_MAX,
  STUDY_LEVEL_NOTE_MAX,
  updatePeriodSchema,
  type AcademicPeriod,
  type StudyTrack,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import { exclusiveLevelInput } from '../../onboarding/onboardingModel';
import { levelLabel, studyErrorText } from '../../studies/studyModel';
import { useCreateStudyPeriod, useUpdateStudyPeriod } from '../../studyTracks/useStudyTracks';

/**
 * The minimum to keep a study alive: see its periods, mark another one as the current one, edit one, add a new one. Marking one
 * current replaces only the current period OF THIS STUDY (other studies keep theirs). No history screen, no deleting here.
 */
export function PeriodsDialog({
  track,
  periods,
  onClose,
  onDone,
}: {
  track: StudyTrack;
  /** The periods of this study, as the API lists them. */
  periods: AcademicPeriod[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const update = useUpdateStudyPeriod();
  const [mode, setMode] = useState<
    { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string }
  >({ kind: 'list' });

  if (mode.kind === 'new' || mode.kind === 'edit') {
    const editing = mode.kind === 'edit' ? periods.find((p) => p.id === mode.id) : undefined;
    return (
      <Modal title={editing ? 'Editar periodo' : 'Nuevo periodo'} onClose={onClose}>
        <PeriodForm
          track={track}
          period={editing}
          hasCurrent={periods.some((p) => p.isCurrent)}
          onCancel={() => setMode({ kind: 'list' })}
          onDone={(message) => {
            setMode({ kind: 'list' });
            onDone(message);
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={`Periodos de ${track.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {update.isError && <FormError>{studyErrorText(update.error)}</FormError>}
        {periods.length === 0 ? (
          <p className="text-foreground">Este estudio todavía no tiene periodos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {periods.map((p) => (
              <li
                key={p.id}
                className="flex min-w-0 flex-col gap-2 rounded-control border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{p.name}</span>
                  {p.isCurrent && <Badge tone="success">Actual</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDateOnly(p.startDate)} – {formatDateOnly(p.endDate)}
                  {levelLabel(track.type, p) && ` · ${levelLabel(track.type, p)}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!p.isCurrent && (
                    <Button
                      size="sm"
                      aria-label={`Marcar ${p.name} como periodo actual`}
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate(
                          { id: p.id, input: { isCurrent: true } },
                          { onSuccess: () => onDone(`«${p.name}» es ahora el periodo actual.`) },
                        )
                      }
                    >
                      Marcar como actual
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar ${p.name}`}
                    onClick={() => setMode({ kind: 'edit', id: p.id })}
                  >
                    Editar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <FormActions>
          <Button onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={() => setMode({ kind: 'new' })}>
            Nuevo periodo
          </Button>
        </FormActions>
      </div>
    </Modal>
  );
}

/** Name, dates and an optional level (a number OR a short description, never both). Dates are never guessed. */
function PeriodForm({
  track,
  period,
  hasCurrent,
  onCancel,
  onDone,
}: {
  track: StudyTrack;
  period?: AcademicPeriod;
  hasCurrent: boolean;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const create = useCreateStudyPeriod();
  const update = useUpdateStudyPeriod();
  const pending = create.isPending || update.isPending;
  const [name, setName] = useState(period?.name ?? '');
  const [startDate, setStartDate] = useState(period?.startDate ?? '');
  const [endDate, setEndDate] = useState(period?.endDate ?? '');
  const [level, setLevel] = useState({
    number: period?.studyLevel != null ? String(period.studyLevel) : '',
    note: period?.studyLevelNote ?? '',
  });
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  function onError(err: Error) {
    if (err instanceof ApiRequestError && Object.keys(err.fieldErrors).length > 0) {
      setFieldErrors(err.fieldErrors);
    } else {
      setFormError(studyErrorText(err));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError(undefined);
    const n = level.number.trim();
    const studyLevel = n === '' ? null : /^\d+$/.test(n) ? Number(n) : Number.NaN;
    const studyLevelNote = level.note.trim() === '' ? null : level.note.trim();
    if (period) {
      const parsed = updatePeriodSchema.safeParse({
        name,
        startDate,
        endDate,
        studyLevel,
        studyLevelNote,
      });
      if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
      setFieldErrors({});
      update.mutate(
        { id: period.id, input: parsed.data },
        { onSuccess: () => onDone('Periodo actualizado.'), onError },
      );
    } else {
      const parsed = createPeriodSchema.safeParse({
        name,
        startDate,
        endDate,
        studyTrackId: track.id,
        ...(studyLevel !== null && { studyLevel }),
        ...(studyLevelNote !== null && { studyLevelNote }),
        ...((makeCurrent || !hasCurrent) && { isCurrent: true }),
      });
      if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
      setFieldErrors({});
      create.mutate(parsed.data, { onSuccess: () => onDone('Periodo creado.'), onError });
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {formError && <FormError>{formError}</FormError>}
      <FormField
        id="period-name"
        label="Nombre del periodo"
        value={name}
        onChange={setName}
        error={fieldErrors.name?.[0]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="period-start"
          label="Inicio"
          type="date"
          value={startDate}
          onChange={setStartDate}
          error={fieldErrors.startDate?.[0]}
        />
        <FormField
          id="period-end"
          label="Fin"
          type="date"
          value={endDate}
          onChange={setEndDate}
          error={fieldErrors.endDate?.[0]}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="period-level-number"
          label={`Nivel (opcional, hasta ${STUDY_LEVEL_MAX})`}
          value={level.number}
          onChange={(v) => setLevel((l) => exclusiveLevelInput('number', v, l))}
          inputMode="numeric"
          maxLength={2}
          autoComplete="off"
          error={fieldErrors.studyLevel?.[0]}
        />
        <FormField
          id="period-level-note"
          label="O descríbelo"
          value={level.note}
          onChange={(v) => setLevel((l) => exclusiveLevelInput('note', v, l))}
          maxLength={STUDY_LEVEL_NOTE_MAX}
          autoComplete="off"
          hint="Usa una sola opción."
          error={fieldErrors.studyLevelNote?.[0]}
        />
      </div>
      {!period && hasCurrent && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={makeCurrent}
            onChange={(e) => setMakeCurrent(e.target.checked)}
            className="size-5"
          />
          Hacerlo el periodo actual (reemplaza al actual de este estudio)
        </label>
      )}
      <FormActions>
        <Button onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Guardando…' : period ? 'Guardar cambios' : 'Crear periodo'}
        </Button>
      </FormActions>
    </form>
  );
}
