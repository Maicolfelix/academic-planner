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
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {formError}
          </p>
        )}
        <FormField
          id="subject-name"
          label="Nombre"
          value={name}
          onChange={setName}
          error={fieldErrors.name?.[0]}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-slate-800">Color</legend>
          <div className="flex flex-wrap gap-2">
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
                  style={{ backgroundColor: value }}
                  className="grid size-9 cursor-pointer place-items-center rounded-full border-2 border-white text-white outline-offset-2 peer-checked:outline-2 peer-checked:outline-slate-900 peer-focus-visible:outline-2 peer-focus-visible:outline-slate-900"
                >
                  {color === value && '✓'}
                </span>
                <span className="sr-only">{SUBJECT_COLOR_NAMES[value]}</span>
              </label>
            ))}
          </div>
          {fieldErrors.color && <p className="text-sm text-red-700">{fieldErrors.color[0]}</p>}
        </fieldset>

        <details
          open={Boolean(subject?.professor || subject?.description) || undefined}
          className="rounded-md border border-slate-300 p-3"
        >
          <summary className="min-h-6 cursor-pointer text-sm font-medium">
            Más opciones (profesor y descripción)
          </summary>
          <div className="mt-3 flex flex-col gap-4">
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
          </div>
        </details>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="min-h-11 rounded-md border border-slate-400 px-4 py-2 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
          >
            {pending ? 'Guardando…' : subject ? 'Guardar cambios' : 'Agregar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
