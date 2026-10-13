import { SUBJECT_NAME_MAX, type PrimaryUse } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { FormField } from '../components/FormField';
import { Button } from '../components/ui/Button';
import { addChip, removeChip, SUBJECT_CHIPS_MAX } from './onboardingModel';

interface Props {
  primaryUse: PrimaryUse | null;
  /** The subjects the current period ALREADY has: shown as they are, never retyped and never sent again. */
  existing: readonly string[];
  /** The names typed and not created yet (kept in the wizard's draft by the page). */
  chips: readonly string[];
  onChips: (next: string[]) => void;
  pending: boolean;
  error?: string;
  /** "Siguiente": one request creates every name (the chips and a name typed but not yet entered). With none, it only moves on. */
  onConfirm: (names: string[]) => void;
}

/**
 * Quick subjects: type a name, Enter, and it becomes a chip; no teacher, no color, no description, no type (the server
 * assigns colors and derives the kind of study). The ones the period already has are shown, so nothing pretends they do
 * not exist. "Siguiente" creates them all in one request (a name typed and not yet entered is not lost: it goes too) and,
 * with nothing to create, simply moves on; that is why there is no separate "skip" here.
 */
export function SubjectsStep({ existing, chips, onChips, pending, error, onConfirm }: Props) {
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  function add(e: FormEvent) {
    e.preventDefault(); // Enter adds a chip; it never submits the step
    const result = addChip(chips, existing, text);
    if (result.error) return setFieldError(result.error);
    setFieldError(undefined);
    if (result.chips.length !== chips.length) onChips(result.chips);
    setText('');
  }

  function next() {
    if (pending) return;
    let names = [...chips];
    if (text.trim() !== '') {
      const result = addChip(chips, existing, text);
      if (result.error) return setFieldError(result.error);
      names = result.chips;
      setText('');
    }
    onConfirm(names);
  }

  const n = chips.length;
  return (
    <>
      {existing.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Ya tienes en este periodo</p>
          <ul aria-label="Materias que ya tienes" className="flex flex-wrap gap-1.5">
            {existing.map((name) => (
              <li
                key={name}
                className="max-w-full rounded-full border border-border bg-secondary px-3 py-1 text-sm break-words text-muted-foreground"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={add} noValidate className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FormField
            id="subject-name"
            label={existing.length > 0 ? 'Agregar otra materia' : 'Escribe una materia'}
            value={text}
            onChange={(v) => {
              setText(v);
              setFieldError(undefined);
            }}
            maxLength={SUBJECT_NAME_MAX}
            autoComplete="off"
            placeholder="Farmacología, Álgebra…"
            hint="Pulsa Enter para agregarla."
            error={fieldError}
            disabled={pending}
          />
        </div>
        <Button type="submit" disabled={pending || text.trim() === ''} aria-label="Agregar materia">
          Agregar
        </Button>
      </form>

      {n > 0 && (
        <ul aria-label="Materias por agregar" className="flex flex-wrap gap-2">
          {chips.map((name) => (
            <li
              key={name}
              className="flex min-h-11 max-w-full items-center gap-1 rounded-full border border-accent bg-accent-soft pl-3 text-sm font-medium text-accent-ink"
            >
              <span className="break-words">{name}</span>
              <button
                type="button"
                aria-label={`Quitar ${name}`}
                disabled={pending}
                onClick={() => onChips(removeChip(chips, name))}
                className="grid size-11 shrink-0 place-items-center rounded-full text-lg leading-none hover:bg-accent/15 disabled:opacity-60"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {n >= SUBJECT_CHIPS_MAX && (
        <p role="status" className="text-sm text-muted-foreground">
          Llegaste al máximo de {SUBJECT_CHIPS_MAX} a la vez; agrega estas y luego las demás.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
        >
          {error} Tus materias siguen aquí: vuelve a intentarlo.
        </p>
      )}

      {n > 0 && !pending && (
        <p className="text-sm text-muted-foreground">
          Al pulsar «Siguiente» se {n === 1 ? 'agregará 1 materia' : `agregarán ${n} materias`}.
        </p>
      )}
      <div>
        <Button
          variant="primary"
          onClick={next}
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? 'Guardando…' : 'Siguiente'}
        </Button>
      </div>
    </>
  );
}
