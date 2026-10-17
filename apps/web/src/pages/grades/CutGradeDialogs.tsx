import { type Evaluation, type GradingPeriod, type GradingProfile } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { FormActions, FormError } from '../../components/ui/form';
import {
  useCreateEvaluation,
  useDeleteEvaluation,
  useUpdateEvaluation,
} from '../../grading/useGrading';
import {
  buildCutGrade,
  cutGradeFormFrom,
  emptyCutGradeForm,
  gradingErrorText,
  pointsConvertAlone,
  type CutGradeFormValues,
  type FormErrors,
} from '../../grading/gradesModel';

const errorText = (err: Error) =>
  err instanceof ApiRequestError ? gradingErrorText(err.code, err.message) : err.message;

/**
 * The grade of a WHOLE cut for this subject (subject → cut → grade): no name, no weight, no cut selector — the subject and the cut
 * are already known. Points only on a scale that starts at 0 (they convert by themselves); on any other scale it is just the grade.
 */
export function CutGradeDialog({
  subjectId,
  cut,
  profile,
  evaluation,
  onClose,
  onDone,
}: {
  subjectId: string;
  cut: GradingPeriod;
  profile: GradingProfile;
  /** Present when editing the grade that already exists. */
  evaluation?: Evaluation;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = useCreateEvaluation(subjectId);
  const update = useUpdateEvaluation(subjectId);
  const pending = create.isPending || update.isPending;
  const [values, setValues] = useState<CutGradeFormValues>(
    evaluation ? cutGradeFormFrom(evaluation) : emptyCutGradeForm(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<CutGradeFormValues>) => setValues({ ...values, ...patch });
  const canUsePoints = pointsConvertAlone(profile);

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const built = buildCutGrade(values, profile, subjectId, cut.id, evaluation);
    if (built.errors) return setErrors(built.errors);
    setErrors({});
    const handlers = {
      onSuccess: onDone,
      onError: (err: Error) => {
        const fields = err instanceof ApiRequestError ? err.fieldErrors : {};
        if (fields.scoreMilli) setErrors({ note: fields.scoreMilli[0] });
        else setFormError(errorText(err));
      },
    };
    if (evaluation) update.mutate({ id: evaluation.id, input: built.update }, handlers);
    else create.mutate(built.create, handlers);
  }

  return (
    <Modal title={`Nota de ${cut.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        {canUsePoints && (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className={FIELD_LABEL}>¿Cómo la tienes?</legend>
            <div className="flex gap-2">
              {(['NOTE', 'POINTS'] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-control border border-border px-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="radio"
                    name="cut-grade-mode"
                    checked={values.mode === mode}
                    onChange={() => set({ mode })}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {mode === 'NOTE' ? 'Nota' : 'Puntos'}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {values.mode === 'NOTE' ? (
          <FormField
            id="cut-grade-note"
            label="Nota"
            inputMode="decimal"
            value={values.note}
            onChange={(note) => set({ note })}
            error={errors.note}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                id="cut-grade-earned"
                label="Obtenidos"
                inputMode="decimal"
                value={values.earned}
                onChange={(earned) => set({ earned })}
                error={errors.earned}
              />
              <FormField
                id="cut-grade-max"
                label="De"
                inputMode="decimal"
                value={values.max}
                onChange={(max) => set({ max })}
                error={errors.max}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              La nota se calcula a partir de los puntos en la escala del periodo.
            </p>
          </>
        )}
        <FormActions>
          <Button onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}

/**
 * A cut that has a direct grade is either that or broken down, never both: to break it down the direct grade goes away first. Asked
 * plainly, with the safe answer first.
 */
export function BreakdownDialog({
  subjectId,
  cut,
  direct,
  onClose,
  onDone,
}: {
  subjectId: string;
  cut: GradingPeriod;
  direct: Evaluation;
  onClose: () => void;
  onDone: () => void;
}) {
  const remove = useDeleteEvaluation(subjectId);
  return (
    <Modal title={`Desglosar ${cut.name}`} onClose={onClose}>
      <p className="mb-5">
        Este corte tiene una nota directa. Para desglosarlo en evaluaciones se quita esa nota y
        registrarás cada evaluación con su peso.
      </p>
      {remove.isError && (
        <div className="mb-4">
          <FormError>{errorText(remove.error)}</FormError>
        </div>
      )}
      <FormActions>
        <Button onClick={onClose} disabled={remove.isPending}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          disabled={remove.isPending}
          onClick={() => remove.mutate(direct.id, { onSuccess: onDone })}
        >
          {remove.isPending ? 'Quitando…' : 'Quitar la nota y desglosar'}
        </Button>
      </FormActions>
    </Modal>
  );
}
