import { searchPrograms, type PrimaryUse, type ProgramEntry } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { FormField } from '../components/FormField';
import { Button } from '../components/ui/Button';
import { programCopy, programNext } from './onboardingModel';

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
  /** "Ahora no": decide this step without saving anything. */
  onSkip: () => void;
}

/**
 * Which program the student studies. Offline and tiny: the catalog of `@planner/core` is searched as they type (case and
 * accent insensitive) and shown as a list of real buttons (not a combobox: an input plus buttons is enough and cannot be
 * announced wrongly). Tapping one only MARKS it; "Siguiente" is what saves it and moves on, so a slip can be corrected. A
 * program the catalog does not have is always one tap away ("Mi carrera no aparece") and is written freely: "Siguiente"
 * saves what was written. For "other study" the free text is the main way and the catalog only suggests. "Ahora no" is the
 * only way to leave without saving.
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
  const [picked, setPicked] = useState<ProgramEntry | null>(null);
  const [custom, setCustom] = useState(freeFirst);
  const [fieldError, setFieldError] = useState<string>();
  const matches = custom && !freeFirst ? [] : searchPrograms(query);

  function next(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const action = programNext({ picked, query, currentName, custom, matches: matches.length });
    if (action.kind === 'error') return setFieldError(action.message);
    setFieldError(undefined);
    if (action.kind === 'catalog') onPickCatalog(action.entry);
    else if (action.kind === 'custom') onSaveCustom(action.name);
    else onSkip();
  }

  return (
    <>
      {currentName && (
        <p className="text-sm text-muted-foreground">
          Ahora tienes: <span className="font-medium text-foreground">{currentName}</span>
        </p>
      )}
      <form onSubmit={next} noValidate className="flex flex-col gap-3">
        <FormField
          id="program"
          label={custom && !freeFirst ? 'Escribe tu carrera o programa' : copy.label}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPicked(null);
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
            {matches.map((m) => {
              const on = picked?.key === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={on}
                  disabled={pending}
                  onClick={() => {
                    setPicked(on ? null : m);
                    setFieldError(undefined);
                  }}
                  className={`flex min-h-11 w-full items-center rounded-control border px-3 py-2 text-left font-medium transition-[background-color,transform] duration-(--duration-fast) ease-standard active:scale-[0.99] disabled:opacity-60 ${
                    on
                      ? 'border-accent bg-accent-soft text-accent-ink'
                      : 'border-border bg-surface hover:bg-secondary'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
        {!custom && !freeFirst && (
          <div>
            <Button onClick={() => setCustom(true)} disabled={pending}>
              Mi carrera no aparece
            </Button>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
          >
            {error} Vuelve a intentarlo.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Guardando…' : 'Siguiente'}
          </Button>
          <Button variant="ghost" onClick={onSkip} disabled={pending}>
            Ahora no
          </Button>
        </div>
      </form>
    </>
  );
}
