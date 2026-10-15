import { STUDY_LEVEL_MAX, STUDY_LEVEL_NOTE_MAX, type PrimaryUse } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { FormField } from '../components/FormField';
import { Button } from '../components/ui/Button';
import { exclusiveLevelInput, levelCopy, levelNext } from './onboardingModel';

interface Props {
  primaryUse: PrimaryUse | null;
  /** What the CURRENT period already has. */
  current: { studyLevel: number | null; studyLevelNote: string | null };
  pending: boolean;
  error?: string;
  onPickNumber: (n: number) => void;
  onSaveNote: (note: string) => void;
  /** "Ahora no": decide this step without saving anything. */
  onSkip: () => void;
  /** "Siguiente" with nothing chosen is "no level" instead of an error (adding a study). */
  optional?: boolean;
}

/**
 * The level the student is at during this period (a semester, a school grade). Tapping a number only MARKS it; "Siguiente"
 * saves and moves on, so a slip can be corrected. "Otro" takes a bigger number (the domain accepts 1 to 99) or a short
 * description, and the two fields exclude each other as they are typed (the domain still refuses both, as a defence). The
 * words change with the use; the data is the same. "Ahora no" is the only way to leave without saving.
 */
export function LevelStep({
  primaryUse,
  current,
  pending,
  error,
  onPickNumber,
  onSaveNote,
  onSkip,
  optional = false,
}: Props) {
  const copy = levelCopy(primaryUse);
  const quick = Array.from({ length: copy.options }, (_, i) => i + 1);
  const beyondQuick =
    current.studyLevelNote !== null ||
    (current.studyLevel !== null && current.studyLevel > copy.options);
  const [other, setOther] = useState(beyondQuick || copy.options === 0);
  const [picked, setPicked] = useState<number | null>(
    current.studyLevel !== null && current.studyLevel <= copy.options ? current.studyLevel : null,
  );
  const [number, setNumber] = useState(
    current.studyLevel !== null && current.studyLevel > copy.options
      ? String(current.studyLevel)
      : '',
  );
  const [note, setNote] = useState(current.studyLevelNote ?? '');
  const [fieldError, setFieldError] = useState<string>();

  function next(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const action = levelNext({
      other,
      picked,
      number,
      note,
      currentLevel: current.studyLevel,
      noun: copy.noun,
      emptyMeansSkip: optional,
    });
    if (action.kind === 'error') return setFieldError(action.message);
    setFieldError(undefined);
    if (action.kind === 'number') onPickNumber(action.value);
    else if (action.kind === 'note') onSaveNote(action.note);
    else onSkip();
  }

  return (
    <form onSubmit={next} noValidate className="flex flex-col gap-4">
      {copy.options > 0 && (
        <div role="group" aria-label={copy.noun} className="grid grid-cols-5 gap-2">
          {quick.map((n) => {
            const on = !other && picked === n;
            return (
              <button
                key={n}
                type="button"
                aria-label={`${copy.noun} ${n}`}
                aria-pressed={on}
                disabled={pending}
                onClick={() => {
                  setPicked(n);
                  setOther(false);
                  setFieldError(undefined);
                }}
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
            aria-pressed={other}
            disabled={pending}
            onClick={() => {
              setOther(true);
              setFieldError(undefined);
            }}
            className={`min-h-12 rounded-control border font-semibold transition-[background-color,transform] duration-(--duration-fast) ease-standard active:scale-95 disabled:opacity-60 ${
              other
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-border bg-surface hover:bg-secondary'
            }`}
          >
            Otro
          </button>
        </div>
      )}

      {other && (
        <div className="flex flex-col gap-3">
          <FormField
            id="level-number"
            label={`Número (hasta ${STUDY_LEVEL_MAX})`}
            value={number}
            onChange={(v) => {
              const fields = exclusiveLevelInput('number', v, { number, note });
              setNumber(fields.number);
              setNote(fields.note);
              setFieldError(undefined);
            }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            hint="Usa una sola opción."
          />
          <FormField
            id="level-note"
            label="O descríbelo"
            value={note}
            onChange={(v) => {
              const fields = exclusiveLevelInput('note', v, { number, note });
              setNumber(fields.number);
              setNote(fields.note);
              setFieldError(undefined);
            }}
            maxLength={STUDY_LEVEL_NOTE_MAX}
            placeholder={copy.placeholder}
            autoComplete="off"
            error={fieldError}
          />
        </div>
      )}
      {!other && fieldError && (
        <p role="alert" className="text-sm text-danger-ink">
          {fieldError}
        </p>
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
        <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>
          {pending ? 'Guardando…' : 'Siguiente'}
        </Button>
        <Button variant="ghost" onClick={onSkip} disabled={pending}>
          Ahora no
        </Button>
      </div>
    </form>
  );
}
