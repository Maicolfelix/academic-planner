import {
  STUDY_LEVEL_MAX,
  STUDY_LEVEL_NOTE_MAX,
  studyLevelSchema,
  type PrimaryUse,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { FormField } from '../components/FormField';
import { Button } from '../components/ui/Button';
import { levelCopy } from './onboardingModel';

interface Props {
  primaryUse: PrimaryUse | null;
  /** What the CURRENT period already has. */
  current: { studyLevel: number | null; studyLevelNote: string | null };
  pending: boolean;
  error?: string;
  onPickNumber: (n: number) => void;
  onSaveNote: (note: string) => void;
  onSkip: () => void;
}

/**
 * The level the student is at during this period (a semester, a school grade): the quick numbers are one tap, and "Otro"
 * takes a bigger number (the domain accepts 1 to 99) or a short description. The words change with the use; the data is the
 * same. Always skippable.
 */
export function LevelStep({
  primaryUse,
  current,
  pending,
  error,
  onPickNumber,
  onSaveNote,
  onSkip,
}: Props) {
  const copy = levelCopy(primaryUse);
  const quick = Array.from({ length: copy.options }, (_, i) => i + 1);
  const beyondQuick =
    current.studyLevelNote !== null ||
    (current.studyLevel !== null && current.studyLevel > copy.options);
  const [other, setOther] = useState(beyondQuick);
  const [number, setNumber] = useState(
    current.studyLevel !== null && current.studyLevel > copy.options
      ? String(current.studyLevel)
      : '',
  );
  const [note, setNote] = useState(current.studyLevelNote ?? '');
  const [fieldError, setFieldError] = useState<string>();

  function saveOther(e: FormEvent) {
    e.preventDefault();
    const n = number.trim();
    const t = note.trim();
    if (n !== '' && t !== '') return setFieldError('Escribe solo uno: el número o la descripción.');
    if (n === '' && t === '') return setFieldError('Escribe un número o una descripción.');
    if (n !== '') {
      const parsed = studyLevelSchema.safeParse(/^\d+$/.test(n) ? Number(n) : Number.NaN);
      if (!parsed.success) return setFieldError(parsed.error.issues[0]!.message);
      setFieldError(undefined);
      return onPickNumber(parsed.data);
    }
    setFieldError(undefined);
    onSaveNote(t);
  }

  return (
    <>
      <div role="group" aria-label={copy.noun} className="grid grid-cols-5 gap-2">
        {quick.map((n) => {
          const on = current.studyLevel === n;
          return (
            <button
              key={n}
              type="button"
              aria-label={`${copy.noun} ${n}`}
              aria-pressed={on}
              disabled={pending}
              onClick={() => onPickNumber(n)}
              className={`min-h-12 rounded-control border text-lg font-semibold transition-[background-color,transform] duration-(--duration-fast) ease-standard active:scale-95 disabled:opacity-60 ${
                on
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-border bg-surface hover:bg-secondary'
              }`}
            >
              {n}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={other}
          aria-pressed={beyondQuick}
          disabled={pending}
          onClick={() => setOther((v) => !v)}
          className={`min-h-12 rounded-control border font-semibold transition-[background-color,transform] duration-(--duration-fast) ease-standard active:scale-95 disabled:opacity-60 ${
            beyondQuick || other
              ? 'border-accent bg-accent-soft text-accent-ink'
              : 'border-border bg-surface hover:bg-secondary'
          }`}
        >
          Otro
        </button>
      </div>

      {other && (
        <form onSubmit={saveOther} noValidate className="flex flex-col gap-3">
          <FormField
            id="level-number"
            label={`Número (hasta ${STUDY_LEVEL_MAX})`}
            value={number}
            onChange={(v) => {
              setNumber(v);
              setFieldError(undefined);
            }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
          />
          <FormField
            id="level-note"
            label="O descríbelo"
            value={note}
            onChange={(v) => {
              setNote(v);
              setFieldError(undefined);
            }}
            maxLength={STUDY_LEVEL_NOTE_MAX}
            placeholder="Internado, año de práctica…"
            autoComplete="off"
            error={fieldError}
          />
          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      )}

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
