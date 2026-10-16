import {
  GRADING_PERIOD_TERMS,
  type EducationContext,
  type Evaluation,
  type GradingPeriod,
  type GradingProfile,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { useActivities } from '../../activities/useActivities';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/ui/Button';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { FormActions, FormError } from '../../components/ui/form';
import { useCreateEvaluation, useUpdateEvaluation } from '../../grading/useGrading';
import {
  buildEvaluation,
  buildQuickGrade,
  emptyEvaluationForm,
  evaluationServerErrors,
  formFromEvaluation,
  gradingErrorText,
  pointsConvertAlone,
  type EvaluationFormValues,
  type FormErrors,
} from '../../grading/gradesModel';

const errorText = (err: Error) =>
  err instanceof ApiRequestError ? gradingErrorText(err.code, err.message) : err.message;

function serverErrors(err: Error): FormErrors | null {
  return err instanceof ApiRequestError ? evaluationServerErrors(err.fieldErrors) : null;
}

/** Add or edit an evaluation of the subject. The subject and period come from the page; the student never types them. */
export function EvaluationDialog({
  subjectId,
  profile,
  cuts,
  studyType,
  evaluation,
  initialCutId,
  onClose,
  onDone,
}: {
  subjectId: string;
  profile: GradingProfile;
  cuts: readonly GradingPeriod[];
  studyType: EducationContext;
  evaluation?: Evaluation;
  initialCutId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = useCreateEvaluation(subjectId);
  const update = useUpdateEvaluation(subjectId);
  const pending = create.isPending || update.isPending;
  const activities = useActivities({ subjectId }, true);
  const term = GRADING_PERIOD_TERMS[studyType].one;

  const [values, setValues] = useState<EvaluationFormValues>(
    evaluation ? formFromEvaluation(evaluation) : emptyEvaluationForm(initialCutId),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<EvaluationFormValues>) => setValues({ ...values, ...patch });
  const alone = pointsConvertAlone(profile);

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const onError = (err: Error) => {
      const mapped = serverErrors(err);
      if (mapped) setErrors(mapped);
      else setFormError(errorText(err));
    };
    if (evaluation) {
      const built = buildEvaluation(values, profile, subjectId, 'update', evaluation);
      if (built.errors) return setErrors(built.errors);
      setErrors({});
      update.mutate({ id: evaluation.id, input: built.input }, { onSuccess: onDone, onError });
    } else {
      const built = buildEvaluation(values, profile, subjectId, 'create');
      if (built.errors) return setErrors(built.errors);
      setErrors({});
      create.mutate(built.input, { onSuccess: onDone, onError });
    }
  }

  return (
    <Modal title={evaluation ? 'Editar evaluación' : 'Agregar evaluación'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        <FormField
          id="eval-name"
          label="Nombre"
          value={values.name}
          maxLength={80}
          onChange={(name) => set({ name })}
          error={errors.name}
        />
        <SelectField
          id="eval-cut"
          label={term}
          value={values.gradingPeriodId}
          onChange={(gradingPeriodId) => set({ gradingPeriodId })}
          options={cuts.map((c) => ({ value: c.id, label: c.name }))}
          error={errors.gradingPeriodId}
        />
        <FormField
          id="eval-weight"
          label={`Peso dentro de ${cuts.find((c) => c.id === values.gradingPeriodId)?.name ?? 'el corte'} (%)`}
          inputMode="decimal"
          value={values.weight}
          onChange={(weight) => set({ weight })}
          error={errors.weight}
          hint="Los pesos de las evaluaciones de un mismo corte no pueden pasar de 100 %."
        />

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={FIELD_LABEL}>Nota (opcional)</legend>
          <div className="flex gap-2">
            {(['NOTE', 'POINTS'] as const).map((mode) => (
              <label
                key={mode}
                className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-control border border-border px-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="score-mode"
                  checked={values.mode === mode}
                  onChange={() => set({ mode })}
                  className="size-4 accent-[var(--accent)]"
                />
                {mode === 'NOTE' ? 'Nota' : 'Puntos'}
              </label>
            ))}
          </div>
          {values.mode === 'NOTE' ? (
            <FormField
              id="eval-note"
              label="Nota"
              inputMode="decimal"
              value={values.note}
              onChange={(note) => set({ note })}
              error={errors.note}
              hint="Déjala vacía si aún no la tienes."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  id="eval-earned"
                  label="Obtenidos"
                  inputMode="decimal"
                  value={values.earned}
                  onChange={(earned) => set({ earned })}
                  error={errors.earned}
                />
                <FormField
                  id="eval-max"
                  label="De"
                  inputMode="decimal"
                  value={values.max}
                  onChange={(max) => set({ max })}
                  error={errors.max}
                />
              </div>
              {alone ? (
                <p className="text-sm text-muted-foreground">
                  La nota se calcula a partir de los puntos en la escala del periodo.
                </p>
              ) : (
                <FormField
                  id="eval-note"
                  label="Nota en la escala del periodo"
                  inputMode="decimal"
                  value={values.note}
                  onChange={(note) => set({ note })}
                  error={errors.note}
                  hint="En esta escala no se convierte sola: escribe también la nota."
                />
              )}
            </>
          )}
        </fieldset>

        {(activities.data?.length ?? 0) > 0 && (
          <SelectField
            id="eval-activity"
            label="Actividad enlazada (opcional)"
            value={values.activityId}
            onChange={(activityId) => set({ activityId })}
            placeholder="Sin actividad"
            options={(activities.data ?? []).map((a) => ({ value: a.id, label: a.title }))}
            error={errors.activityId}
          />
        )}

        <FormActions>
          <Button onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Guardando…' : evaluation ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}

/** Put a score on a pending evaluation without editing anything else. */
export function QuickGradeDialog({
  subjectId,
  profile,
  evaluation,
  onClose,
  onDone,
}: {
  subjectId: string;
  profile: GradingProfile;
  evaluation: Evaluation;
  onClose: () => void;
  onDone: () => void;
}) {
  const update = useUpdateEvaluation(subjectId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const built = buildQuickGrade(note, profile);
    if (built.error) return setError(built.error);
    setError(undefined);
    update.mutate(
      { id: evaluation.id, input: { scoreMilli: built.scoreMilli } },
      {
        onSuccess: onDone,
        onError: (err) => {
          const mapped = serverErrors(err);
          if (mapped?.note) setError(mapped.note);
          else setFormError(errorText(err));
        },
      },
    );
  }

  return (
    <Modal title={`Nota de ${evaluation.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        <FormField
          id="quick-note"
          label="Nota"
          inputMode="decimal"
          value={note}
          onChange={setNote}
          error={error}
        />
        <FormActions>
          <Button onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? 'Guardando…' : 'Guardar nota'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
