import {
  createSubjectSchema,
  type CreateSubjectInput,
  fieldErrorsOf,
  findSubjectByName,
  pickSubjectColor,
  type Subject,
} from '@planner/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useCreateSubject } from '../../academic/useAcademic';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/form';

export const INLINE_SUBJECT_NAME_ID = 'inline-subject-name';

interface Props {
  /** The student's subjects of the period (to reuse one that already has that name, and to pick an unused color). */
  subjects: readonly Subject[];
  periodId: string | undefined;
  /** `existing`: the name was already one of the student's subjects, so it was selected and nothing was created. */
  onCreated: (subject: Subject, existing: boolean) => void;
  onCancel: () => void;
}

export type InlineSubjectDecision =
  /** The name is already one of the student's subjects: select it, create nothing. */
  | { kind: 'EXISTING'; subject: Subject }
  | { kind: 'CREATE'; input: CreateSubjectInput }
  | { kind: 'INVALID'; field: 'name' | 'form'; message: string };

/**
 * What pressing "Crear y usar" means, as a pure rule: a name the student already has (compared like the database does,
 * so the id comes from their own list and is never guessed) selects that subject; otherwise the name must be valid and
 * the request carries the period and the first palette color the period does not use yet.
 */
export function decideInlineSubject(
  rawName: string,
  subjects: readonly Subject[],
  periodId: string | undefined,
): InlineSubjectDecision {
  const name = rawName.trim();
  const existing = name === '' ? undefined : findSubjectByName(name, subjects);
  if (existing) return { kind: 'EXISTING', subject: existing };
  if (!periodId) {
    return {
      kind: 'INVALID',
      field: 'form',
      message: 'No pudimos identificar tu periodo. Recarga e inténtalo de nuevo.',
    };
  }
  const parsed = createSubjectSchema.safeParse({
    periodId,
    name,
    color: pickSubjectColor(subjects.map((s) => s.color)),
  });
  if (!parsed.success) {
    return {
      kind: 'INVALID',
      field: 'name',
      message: fieldErrorsOf(parsed.error).name?.[0] ?? 'Ingresa el nombre de la asignatura.',
    };
  }
  return { kind: 'CREATE', input: parsed.data };
}

/**
 * "Nueva asignatura", inline in the activity form: a name, "Cancelar" and "Crear y usar". It is not a form (the
 * activity form around it is one and forms cannot nest), so Enter in the name is handled here: it creates the
 * subject and never saves the activity. Nothing is stored until the student asks for it. The subject is created with
 * the existing `POST /api/subjects` (the period is the student's current one, the color the first unused one).
 *
 * A name the student already has (compared like the database does) selects that subject instead of creating a
 * duplicate; the id always comes from the student's own list, never guessed from an error.
 */
export function InlineSubjectCreator({ subjects, periodId, onCreated, onCancel }: Props) {
  const create = useCreateSubject();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  // Opening it puts the focus in the name.
  useEffect(() => {
    document.getElementById(INLINE_SUBJECT_NAME_ID)?.focus();
  }, []);

  function submit() {
    if (create.isPending) return;
    setFormError(undefined);
    const decision = decideInlineSubject(name, subjects, periodId);
    if (decision.kind === 'EXISTING') return onCreated(decision.subject, true);
    if (decision.kind === 'INVALID') {
      if (decision.field === 'name') setNameError(decision.message);
      else setFormError(decision.message);
      return;
    }
    setNameError(undefined);
    create.mutate(decision.input, {
      onSuccess: (subject) => onCreated(subject, false),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.fieldErrors.name?.[0]) {
          setNameError(err.fieldErrors.name[0]);
          // The name belongs to a subject this list did not have (stale): refresh it, so asking again selects it.
          if (err.status === 409) void qc.invalidateQueries({ queryKey: ['subjects'] });
        } else {
          setFormError(err.message);
        }
      },
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    // Only the text box: Enter on a button still presses that button.
    if ((e.target as HTMLElement).tagName !== 'INPUT') return;
    e.preventDefault();
    submit();
  }

  return (
    <div
      role="group"
      aria-labelledby="inline-subject-title"
      onKeyDown={onKeyDown}
      className="flex animate-rise flex-col gap-3 rounded-control border border-border-strong bg-secondary/40 p-3"
    >
      <p id="inline-subject-title" className="font-medium text-foreground">
        Nueva asignatura
      </p>
      {formError && <FormError>{formError}</FormError>}
      <FormField
        id={INLINE_SUBJECT_NAME_ID}
        label="Nombre"
        autoComplete="off"
        value={name}
        onChange={(value) => {
          setName(value);
          setNameError(undefined);
        }}
        error={nameError}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={onCancel} disabled={create.isPending}>
          Cancelar
        </Button>
        {/* Not disabled while it runs: a disabled button would drop the focus (submit ignores a second press). */}
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          aria-busy={create.isPending || undefined}
        >
          {create.isPending ? 'Creando…' : 'Crear y usar'}
        </Button>
      </div>
    </div>
  );
}
