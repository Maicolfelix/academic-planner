import {
  createSubjectSchema,
  DEFAULT_SUBJECT_COLOR,
  fieldErrorsOf,
  SUBJECT_COLOR_NAMES,
  SUBJECT_COLOR_VALUES,
  updateSubjectSchema,
  type Subject,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { useCreateSubject, useUpdateSubject } from '../../academic/useAcademic';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { Disclosure, FieldError, FormActions, FormError } from '../../components/ui/form';
import { CheckIcon } from '../../components/ui/icons';
import { readableInk } from '../../lib/readableInk';
import { initialsOf } from './SubjectCard';
import { Modal } from '../../components/Modal';

interface Props {
  periodId: string;
  /** Present when editing. */
  subject?: Subject;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Create/edit form. Name + color up front; professor and description behind a disclosure. */
export function SubjectFormDialog({ periodId, subject, onClose, onSaved }: Props) {
  const create = useCreateSubject();
  const update = useUpdateSubject();
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState<string>(subject?.color ?? DEFAULT_SUBJECT_COLOR);
  const [professor, setProfessor] = useState(subject?.professor ?? '');
  const [description, setDescription] = useState(subject?.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  function onError(err: Error) {
    if (err instanceof ApiRequestError && Object.keys(err.fieldErrors).length > 0) {
      setFieldErrors(err.fieldErrors);
    } else {
      setFormError(err.message);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);

    if (subject) {
      const parsed = updateSubjectSchema.safeParse({ name, color, professor, description });
      if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
      setFieldErrors({});
      update.mutate(
        { id: subject.id, input: parsed.data },
        { onSuccess: () => onSaved('Asignatura actualizada.'), onError },
      );
    } else {
      const parsed = createSubjectSchema.safeParse({
        periodId,
        name,
        color,
        professor,
        description,
      });
      if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
      setFieldErrors({});
      create.mutate(parsed.data, { onSuccess: () => onSaved('Asignatura creada.'), onError });
    }
  }

  return (
    <Modal title={subject ? 'Editar asignatura' : 'Agregar asignatura'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}

        {/* The tile of the card, live: the chosen color and the letters of the name (decoration, hidden from assistive tech). */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            data-subject-preview
            style={{ backgroundColor: color, color: readableInk(color) }}
            className="mt-7 grid size-12 shrink-0 place-items-center rounded-2xl text-xl font-bold shadow-card transition-colors duration-(--duration-fast) ease-standard"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0 flex-1">
            <FormField
              id="subject-name"
              label="Nombre"
              value={name}
              onChange={setName}
              error={fieldErrors.name?.[0]}
            />
          </div>
        </div>

        {/* A closed palette: real radio buttons (arrows move between them), each with its color's NAME for a screen reader. */}
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={FIELD_LABEL}>Color</legend>
          <div className="flex flex-wrap gap-2.5 p-1">
            {SUBJECT_COLOR_VALUES.map((value) => (
              <label key={value} className="relative">
                <input
                  type="radio"
                  name="color"
                  value={value}
                  checked={color === value}
                  onChange={() => setColor(value)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: value, color: readableInk(value) }}
                  className="grid size-10 cursor-pointer place-items-center rounded-full ring-offset-2 ring-offset-surface-elevated transition-transform duration-(--duration-fast) ease-spring hover:scale-110 peer-checked:scale-105 peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                >
                  {color === value && <CheckIcon className="size-5" />}
                </span>
                <span className="sr-only">{SUBJECT_COLOR_NAMES[value]}</span>
              </label>
            ))}
          </div>
          {fieldErrors.color && (
            <FieldError id="subject-color-error">{fieldErrors.color[0]}</FieldError>
          )}
        </fieldset>

        <Disclosure
          summary="Más opciones (profesor y descripción)"
          open={Boolean(subject?.professor || subject?.description)}
        >
          <FormField
            id="subject-professor"
            label="Profesor"
            value={professor}
            onChange={setProfessor}
            error={fieldErrors.professor?.[0]}
          />
          <FormField
            id="subject-description"
            label="Descripción"
            multiline
            value={description}
            onChange={setDescription}
            error={fieldErrors.description?.[0]}
          />
        </Disclosure>

        <FormActions>
          <Button onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Guardando…' : subject ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
