import { searchPrograms, type PrimaryUse, type ProgramEntry } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { FormField } from '../components/FormField';
import { Button } from '../components/ui/Button';
import { programCopy } from './onboardingModel';

interface Props {
  primaryUse: PrimaryUse | null;
  /** What the server already has (shown, and the field starts with it). */
  currentName: string | null;
  pending: boolean;
  error?: string;
  /** A catalog entry: the SERVER derives the name from its key. */
  onPickCatalog: (entry: ProgramEntry) => void;
  /** A program the student wrote (no key). */
  onSaveCustom: (name: string) => void;
  onSkip: () => void;
}

/**
 * Which program the student studies. Offline and tiny: the catalog of `@planner/core` is searched as they type (case and
 * accent insensitive) and shown as a list of real buttons (not a combobox: an input plus buttons is enough and cannot be
 * announced wrongly). A program the catalog does not have is always one tap away ("Mi carrera no aparece") and is written
 * freely. For "other study" the free text is the main way and the catalog only suggests. Always skippable.
 */
export function ProgramStep({
  primaryUse,
  currentName,
  pending,
  error,
  onPickCatalog,
  onSaveCustom,
  onSkip,
}: Props) {
  const copy = programCopy(primaryUse);
  const freeFirst = primaryUse === 'OTHER_STUDENT';
  const [query, setQuery] = useState(currentName ?? '');
  const [custom, setCustom] = useState(freeFirst);
  const [fieldError, setFieldError] = useState<string>();
  const matches = custom && !freeFirst ? [] : searchPrograms(query);

  function save(e: FormEvent) {
    e.preventDefault();
    const name = query.trim();
    if (name === '') return setFieldError('Escribe el nombre o toca «Omitir este paso».');
    if (name.length > 80)
      return setFieldError('El nombre es demasiado largo (máximo 80 caracteres).');
    setFieldError(undefined);
    onSaveCustom(name);
  }

  return (
    <>
      {currentName && (
        <p className="text-sm text-muted-foreground">
          Ahora tienes: <span className="font-medium text-foreground">{currentName}</span>
        </p>
      )}
      <form onSubmit={save} noValidate className="flex flex-col gap-3">
        <FormField
          id="program"
          label={custom && !freeFirst ? 'Escribe tu carrera o programa' : copy.label}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setFieldError(undefined);
          }}
          placeholder={copy.placeholder}
          maxLength={80}
          autoComplete="off"
          error={fieldError}
        />
        {matches.length > 0 && (
          <div role="group" aria-label="Coincidencias" className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {freeFirst ? '¿Es alguno de estos?' : 'Toca el tuyo:'}
            </p>
            {matches.map((m) => (
              <button
                key={m.key}
                type="button"
                disabled={pending}
                onClick={() => onPickCatalog(m)}
                className="flex min-h-11 w-full items-center rounded-control border border-border bg-surface px-3 py-2 text-left font-medium transition-[background-color,transform] duration-(--duration-fast) ease-standard hover:bg-secondary active:scale-[0.99] disabled:opacity-60"
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(custom || freeFirst) && (
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          )}
          {!custom && !freeFirst && (
            <Button onClick={() => setCustom(true)} disabled={pending}>
              Mi carrera no aparece
            </Button>
          )}
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
        >
          {error} Vuelve a intentarlo.
        </p>
      )}

      <div>
        <Button variant="ghost" onClick={onSkip} disabled={pending}>
          Omitir este paso
        </Button>
      </div>
    </>
  );
}
