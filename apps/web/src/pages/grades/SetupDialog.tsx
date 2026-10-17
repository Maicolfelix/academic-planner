import {
  GRADING_PERIOD_TERMS,
  SCALE_PRESETS,
  bpToPercentText,
  cutPresets,
  defaultCutName,
  remainderOf,
  type EducationContext,
  type SetupSubjectGradingInput,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/ui/Button';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { FormActions, FormError } from '../../components/ui/form';
import { useSetupSubjectGrading } from '../../grading/useGrading';
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
  subjectId: string;
  subjectName: string;
  studyType: EducationContext;
  /** The period already has its scale: the dialog then only asks how THIS subject splits its final grade. */
  hasScale: boolean;
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
 * The first configuration of a SUBJECT, in one request. The SCALE belongs to the period (shared by its subjects): it is asked only
 * while the period has none. The CUTS belong to the subject: every subject is asked how ITS final grade is split, with quick
 * options that are only helps (never an inference from the institution) and a custom editor where ONE blank percentage takes the
 * rest. Nothing is saved until the last "Guardar", so closing in the middle leaves nothing half done.
 */
export function SetupDialog({
  subjectId,
  subjectName,
  studyType,
  hasScale,
  onClose,
  onDone,
}: Props) {
  const setup = useSetupSubjectGrading(subjectId);
  const terms = GRADING_PERIOD_TERMS[studyType];
  const presets = cutPresets(studyType);

  const [step, setStep] = useState<1 | 2>(hasScale ? 2 : 1);
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
    let profile: SetupSubjectGradingInput['profile'];
    if (!hasScale) {
      const built = buildScale(scale);
      if (built.errors) {
        setStep(1);
        return setScaleErrors(built.errors);
      }
      profile = built.profile;
    }
    const cuts = buildCuts(rows);
    if (cuts.errors) return setCutErrors(cuts.errors);
    setCutErrors([]);
    setup.mutate(
      { ...(profile && { profile }), gradingPeriods: cuts.cuts },
      {
        onSuccess: onDone,
        onError: (err) =>
          setFormError(
            err instanceof ApiRequestError ? gradingErrorText(err.code, err.message) : err.message,
          ),
      },
    );
  }

  const total = rowsTotalBp(rows);
  const rest = remainderOf(rows);

  return (
    <Modal
      title={step === 1 ? 'Configurar notas · Escala' : `Configurar notas · ${terms.many}`}
      onClose={onClose}
    >
      {step === 1 && (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            La escala se comparte con las demás materias de este periodo.
          </p>
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
        </>
      )}

      {step === 2 && (
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          {formError && <FormError>{formError}</FormError>}
          <Choices
            legend={`¿Cómo se divide ${subjectName}? (${terms.many})`}
            name="cuts"
            value={cutChoice}
            onChange={chooseCuts}
            options={[
              ...presets.map((p) => ({ value: p.id, label: p.label })),
              { value: CUSTOM, label: 'Personalizar' },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Cada materia tiene su propia distribución: esto solo vale para {subjectName}.
          </p>
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
                    placeholder={rest?.index === i ? bpToPercentText(rest.bp) : undefined}
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
                {rest
                  ? `El peso que dejes en blanco tomará el resto: ${bpToPercentText(rest.bp)} %.`
                  : `Suman ${bpToPercentText(total)} %. Deben sumar 100 %.`}
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
            <Button onClick={() => (hasScale ? onClose() : setStep(1))} disabled={setup.isPending}>
              {hasScale ? 'Cancelar' : 'Atrás'}
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
