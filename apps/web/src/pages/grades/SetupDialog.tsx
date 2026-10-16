import {
  GRADING_PERIOD_TERMS,
  SCALE_PRESETS,
  cutPresets,
  defaultCutName,
  formatPercent,
  type EducationContext,
  type SetupGradingInput,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/ui/Button';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { FormActions, FormError } from '../../components/ui/form';
import { useSetupGrading } from '../../grading/useGrading';
import {
  buildCuts,
  buildScale,
  gradingErrorText,
  rowsFromDrafts,
  rowsTotalBp,
  type CutRow,
  type ScaleErrors,
  type ScaleFormValues,
} from '../../grading/gradesModel';

interface Props {
  periodId: string;
  studyType: EducationContext;
  onClose: () => void;
  onDone: () => void;
}

const CUSTOM = 'CUSTOM';

const presetValues = (id: string): ScaleFormValues => {
  const p = SCALE_PRESETS.find((s) => s.id === id) ?? SCALE_PRESETS[0]!;
  return {
    min: String(p.minMilli / 1000),
    max: String(p.maxMilli / 1000),
    pass: String(p.passMilli / 1000),
    decimals: String(p.decimals),
  };
};

/** A radio group of native radios, said in words (the selected one is also marked by the control itself, never by color alone). */
function Choices({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={FIELD_LABEL}>{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="size-4 shrink-0 accent-[var(--accent)]"
          />
          <span className="min-w-0 break-words">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The first configuration of a period, in two steps and ONE request: the scale, then the cuts. Nothing is saved until the last
 * "Guardar", so closing in the middle leaves nothing half done. Friendly numbers only (3.0, 40 %); the conversions are core's.
 */
export function SetupDialog({ periodId, studyType, onClose, onDone }: Props) {
  const setup = useSetupGrading(periodId);
  const terms = GRADING_PERIOD_TERMS[studyType];
  const presets = cutPresets(studyType);

  const [step, setStep] = useState<1 | 2>(1);
  const [scaleChoice, setScaleChoice] = useState<string>(SCALE_PRESETS[0]!.id);
  const [scale, setScale] = useState<ScaleFormValues>(presetValues(SCALE_PRESETS[0]!.id));
  const [scaleErrors, setScaleErrors] = useState<ScaleErrors>({});

  const [cutChoice, setCutChoice] = useState<string>(presets[0]!.id);
  const [rows, setRows] = useState<CutRow[]>(rowsFromDrafts(presets[0]!.cuts));
  const [cutErrors, setCutErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState<string>();

  function chooseScale(id: string) {
    setScaleChoice(id);
    if (id !== CUSTOM) setScale(presetValues(id));
    setScaleErrors({});
  }

  function chooseCuts(id: string) {
    setCutChoice(id);
    if (id === CUSTOM) {
      if (rows.length < 2) setRows(rowsFromDrafts(presets[0]!.cuts));
    } else {
      setRows(rowsFromDrafts(presets.find((p) => p.id === id)!.cuts));
    }
    setCutErrors([]);
  }

  function next(e: FormEvent) {
    e.preventDefault();
    const built = buildScale(scale);
    if (built.errors) return setScaleErrors(built.errors);
    setScaleErrors({});
    setStep(2);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const profile = buildScale(scale);
    if (profile.errors) {
      setStep(1);
      return setScaleErrors(profile.errors);
    }
    const cuts = buildCuts(rows);
    if (cuts.errors) return setCutErrors(cuts.errors);
    setCutErrors([]);
    const input: SetupGradingInput = { profile: profile.profile, gradingPeriods: cuts.cuts };
    setup.mutate(input, {
      onSuccess: onDone,
      onError: (err) =>
        setFormError(
          err instanceof ApiRequestError ? gradingErrorText(err.code, err.message) : err.message,
        ),
    });
  }

  const total = rowsTotalBp(rows);

  return (
    <Modal
      title={step === 1 ? 'Configurar notas · Escala' : `Configurar notas · ${terms.many}`}
      onClose={onClose}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        La escala y {terms.theMany} se comparten con las demás materias de este periodo.
      </p>

      {step === 1 && (
        <form onSubmit={next} noValidate className="flex flex-col gap-4">
          <Choices
            legend="¿Cómo se califica?"
            name="scale"
            value={scaleChoice}
            onChange={chooseScale}
            options={[
              ...SCALE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              { value: CUSTOM, label: 'Personalizada' },
            ]}
          />
          {scaleChoice === CUSTOM && (
            <div className="grid grid-cols-2 gap-3">
              <FormField
                id="scale-min"
                label="Mínimo"
                inputMode="decimal"
                value={scale.min}
                onChange={(min) => setScale({ ...scale, min })}
                error={scaleErrors.min}
              />
              <FormField
                id="scale-max"
                label="Máximo"
                inputMode="decimal"
                value={scale.max}
                onChange={(max) => setScale({ ...scale, max })}
                error={scaleErrors.max}
              />
              <FormField
                id="scale-pass"
                label="Aprueba con"
                inputMode="decimal"
                value={scale.pass}
                onChange={(pass) => setScale({ ...scale, pass })}
                error={scaleErrors.pass}
              />
              <SelectField
                id="scale-decimals"
                label="Decimales"
                value={scale.decimals}
                onChange={(decimals) => setScale({ ...scale, decimals })}
                options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                error={scaleErrors.decimals}
              />
            </div>
          )}
          <FormActions>
            <Button onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="primary">
              Siguiente
            </Button>
          </FormActions>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          {formError && <FormError>{formError}</FormError>}
          <Choices
            legend={`¿Cómo se reparte la nota final? (${terms.many})`}
            name="cuts"
            value={cutChoice}
            onChange={chooseCuts}
            options={[
              ...presets.map((p) => ({ value: p.id, label: p.label })),
              { value: CUSTOM, label: 'Personalizar' },
            ]}
          />
          {cutChoice === CUSTOM && (
            <div className="flex flex-col gap-3">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_6rem] items-end gap-2">
                  <FormField
                    id={`cut-name-${i}`}
                    label={`${terms.one} ${i + 1}`}
                    value={row.name}
                    maxLength={80}
                    onChange={(name) => setRows(rows.map((r, j) => (j === i ? { ...r, name } : r)))}
                  />
                  <FormField
                    id={`cut-percent-${i}`}
                    label="Peso (%)"
                    inputMode="decimal"
                    value={row.percent}
                    onChange={(percent) =>
                      setRows(rows.map((r, j) => (j === i ? { ...r, percent } : r)))
                    }
                  />
                  {rows.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="col-span-2 justify-self-start text-danger"
                      aria-label={`Quitar ${row.name || `${terms.one} ${i + 1}`}`}
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    >
                      Quitar
                    </Button>
                  )}
                </div>
              ))}
              {rows.length < 12 && (
                <Button
                  onClick={() =>
                    setRows([
                      ...rows,
                      { name: defaultCutName(studyType, rows.length + 1), percent: '' },
                    ])
                  }
                >
                  Agregar {terms.one.toLowerCase()}
                </Button>
              )}
              <p role="status" className="text-sm text-muted-foreground">
                Suman {formatPercent(total)}.
                {total < 10_000 && ' Si falta, tus cálculos se marcarán como estimación.'}
              </p>
            </div>
          )}
          {cutErrors.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-sm text-danger-ink">
              {cutErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <FormActions>
            <Button onClick={() => setStep(1)} disabled={setup.isPending}>
              Atrás
            </Button>
            <Button type="submit" variant="primary" disabled={setup.isPending}>
              {setup.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  );
}
