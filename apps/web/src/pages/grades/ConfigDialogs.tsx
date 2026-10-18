import {
  GRADING_PERIOD_TERMS,
  bpToPercentText,
  percentToBp,
  type EducationContext,
  type GradingPeriod,
  type GradingProfile,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import {
  useCreateGradingPeriod,
  useDeleteEvaluation,
  useDeleteGradingPeriod,
  useReplaceCutWeights,
  useUpdateGradingPeriod,
  useUpdateGradingProfile,
} from '../../grading/useGrading';
import {
  buildScale,
  distributionFrom,
  distributionRequest,
  distributionShown,
  distributionSummary,
  editDistribution,
  setDistributionAuto,
  type DistRow,
  gradingErrorText,
  scaleFormFrom,
  type ScaleErrors,
  type ScaleFormValues,
} from '../../grading/gradesModel';

const errorText = (err: Error) =>
  err instanceof ApiRequestError ? gradingErrorText(err.code, err.message) : err.message;

/** Edit the scale of the period: the pass mark and the decimals always; the minimum and maximum only until grades exist. */
export function ScaleEditDialog({
  periodId,
  profile,
  onClose,
  onDone,
}: {
  periodId: string;
  profile: GradingProfile;
  onClose: () => void;
  onDone: () => void;
}) {
  const update = useUpdateGradingProfile(periodId);
  const [values, setValues] = useState<ScaleFormValues>(scaleFormFrom(profile));
  const [errors, setErrors] = useState<ScaleErrors>({});
  const [formError, setFormError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const built = buildScale(values);
    if (built.errors) return setErrors(built.errors);
    setErrors({});
    update.mutate(built.profile, {
      onSuccess: onDone,
      onError: (err) => setFormError(errorText(err)),
    });
  }

  return (
    <Modal title="Escala de notas" onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        La escala se comparte con las demás materias de este periodo.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        <div className="grid grid-cols-2 gap-3">
          <FormField
            id="edit-min"
            label="Mínimo"
            inputMode="decimal"
            value={values.min}
            onChange={(min) => setValues({ ...values, min })}
            error={errors.min}
          />
          <FormField
            id="edit-max"
            label="Máximo"
            inputMode="decimal"
            value={values.max}
            onChange={(max) => setValues({ ...values, max })}
            error={errors.max}
          />
          <FormField
            id="edit-pass"
            label="Aprueba con"
            inputMode="decimal"
            value={values.pass}
            onChange={(pass) => setValues({ ...values, pass })}
            error={errors.pass}
          />
          <SelectField
            id="edit-decimals"
            label="Decimales"
            value={values.decimals}
            onChange={(decimals) => setValues({ ...values, decimals })}
            options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
            error={errors.decimals}
          />
        </div>
        <FormActions>
          <Button onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}

/** Add or edit ONE cut of the period (name and weight over the final grade). */
export function CutDialog({
  subjectId,
  studyType,
  cut,
  defaultName,
  onClose,
  onDone,
}: {
  subjectId: string;
  studyType: EducationContext;
  cut?: GradingPeriod;
  defaultName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const term = GRADING_PERIOD_TERMS[studyType].one;
  const create = useCreateGradingPeriod(subjectId);
  const update = useUpdateGradingPeriod(subjectId);
  const pending = create.isPending || update.isPending;
  const [name, setName] = useState(cut?.name ?? defaultName);
  const [weight, setWeight] = useState(cut ? bpToPercentText(cut.finalShareBp) : '');
  const [errors, setErrors] = useState<{ name?: string; weight?: string }>({});
  const [formError, setFormError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const found: { name?: string; weight?: string } = {};
    const bp = percentToBp(weight);
    if (!name.trim()) found.name = 'Escribe el nombre.';
    if (bp === null || bp < 1) found.weight = 'Escribe un peso entre 0 y 100 %.';
    setErrors(found);
    if (found.name || found.weight) return;
    const input = { name: name.trim(), finalShareBp: bp as number };
    const handlers = {
      onSuccess: onDone,
      onError: (err: Error) => {
        if (err instanceof ApiRequestError && err.fieldErrors.finalShareBp)
          setErrors({ weight: err.fieldErrors.finalShareBp[0] });
        else setFormError(errorText(err));
      },
    };
    if (cut) update.mutate({ id: cut.id, input }, handlers);
    else create.mutate(input, handlers);
  }

  return (
    <Modal
      title={cut ? `Editar ${term.toLowerCase()}` : `Agregar ${term.toLowerCase()}`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        <FormField
          id="cut-name"
          label="Nombre"
          value={name}
          maxLength={80}
          onChange={setName}
          error={errors.name}
        />
        <FormField
          id="cut-weight"
          label="Peso en la nota final (%)"
          inputMode="decimal"
          value={weight}
          onChange={setWeight}
          error={errors.weight}
          hint="Los pesos de los cortes de esta materia no pueden pasar de 100 %."
        />
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

/** A short confirmation for removing a cut (only an empty one can go) or an evaluation. Cancel has the focus. */
export function ConfirmRemoveDialog({
  kind,
  id,
  name,
  subjectId,
  onClose,
  onDone,
}: {
  kind: 'cut' | 'evaluation';
  id: string;
  name: string;
  subjectId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const removeCut = useDeleteGradingPeriod(subjectId);
  const removeEvaluation = useDeleteEvaluation(subjectId);
  const remove = kind === 'cut' ? removeCut : removeEvaluation;
  return (
    <Modal title={`¿Eliminar ${name}?`} onClose={onClose}>
      <p className="mb-5">
        {kind === 'cut'
          ? 'Se elimina el corte. Solo se puede si no tiene evaluaciones.'
          : 'Se elimina la evaluación y su nota. La actividad enlazada no se borra.'}
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
          variant="danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate(id, { onSuccess: onDone })}
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </FormActions>
    </Modal>
  );
}

/**
 * How the final grade of a subject is split, edited TOGETHER: every cut and its percentage in view, the total always shown, and one
 * "automatic" cut that takes whatever the others leave. It only saves when the cuts add up to exactly 100 %; nothing changes behind
 * the student's back and the other cuts are never redistributed.
 */
export function DistributionDialog({
  subjectId,
  cuts,
  term,
  onClose,
  onDone,
}: {
  subjectId: string;
  cuts: readonly GradingPeriod[];
  term: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const replace = useReplaceCutWeights(subjectId);
  const [rows, setRows] = useState<DistRow[]>(() => distributionFrom(cuts));
  const [formError, setFormError] = useState<string>();
  const summary = distributionSummary(rows);

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const input = distributionRequest(rows);
    if (!input) return;
    replace.mutate(input, { onSuccess: onDone, onError: (err) => setFormError(errorText(err)) });
  }

  return (
    <Modal title="Editar distribución" onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        Los {term.toLowerCase()}s de esta materia deben sumar exactamente 100 %. Un corte puede
        completarse solo con lo que falte; los demás no se mueven.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-control border border-line p-3">
              <FormField
                id={`dist-${row.id}`}
                label={`${row.name} (%)`}
                inputMode="decimal"
                value={distributionShown(rows, row.id)}
                onChange={(text) => setRows(editDistribution(rows, row.id, text))}
                hint={row.auto ? 'Se completa solo con lo que falte.' : undefined}
              />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={row.auto}
                  onChange={(e) => setRows(setDistributionAuto(rows, row.id, e.target.checked))}
                  aria-label={`Completar automáticamente: ${row.name}`}
                  className="size-5 accent-[var(--accent)]"
                />
                Completar automáticamente
              </label>
            </li>
          ))}
        </ul>
        <div role="status" className="flex flex-col gap-0.5 text-sm">
          <p>
            Total definido: <strong>{summary.defined}</strong> · Restante:{' '}
            <strong>{summary.remaining}</strong>
          </p>
          {summary.messages.map((m) => (
            <p key={m.text} className={m.tone === 'ok' ? 'text-success-ink' : 'text-warning-ink'}>
              {m.text}
            </p>
          ))}
        </div>
        <FormActions>
          <Button onClick={onClose} disabled={replace.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={replace.isPending || !summary.canSave}>
            {replace.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
