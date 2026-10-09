import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_PRIORITY_LABELS,
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  createActivitySchema,
  DEFAULT_ACTIVITY_PRIORITY,
  DEFAULT_ACTIVITY_TYPE,
  fieldErrorsOf,
  toLocalParts,
  updateActivitySchema,
  type Activity,
  type Subject,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { useCreateActivity, useUpdateActivity } from '../../activities/useActivities';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { Disclosure, FormActions, FormError } from '../../components/ui/form';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { ReminderSection } from '../reminders/ReminderSection';

interface Props {
  subjects: Subject[];
  /** Present when editing. */
  activity?: Activity;
  /** Subject chosen in the page filter: saves the student one selection. */
  defaultSubjectId?: string;
  timeZone: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * Quick path: title, subject, date. Time, type, priority and description sit behind "Más opciones".
 * Status is only editable on an existing activity (a new one always starts Pendiente).
 */
export function ActivityFormDialog({
  subjects,
  activity,
  defaultSubjectId,
  timeZone,
  onClose,
  onSaved,
}: Props) {
  const create = useCreateActivity();
  const update = useUpdateActivity();
  const pending = create.isPending || update.isPending;

  // The wall-clock date/time come from core: the form never does timezone math itself.
  const local = activity ? toLocalParts(activity.dueAt, timeZone) : undefined;

  const [title, setTitle] = useState(activity?.title ?? '');
  const [subjectId, setSubjectId] = useState(
    activity?.subjectId ??
      (defaultSubjectId && subjects.some((s) => s.id === defaultSubjectId) ? defaultSubjectId : ''),
  );
  const [dueDate, setDueDate] = useState(local?.date ?? '');
  const [dueTime, setDueTime] = useState(activity?.hasTime && local ? local.time : '');
  const [type, setType] = useState<string>(activity?.type ?? DEFAULT_ACTIVITY_TYPE);
  const [priority, setPriority] = useState<string>(activity?.priority ?? DEFAULT_ACTIVITY_PRIORITY);
  const [status, setStatus] = useState<string>(activity?.status ?? 'PENDING');
  const [description, setDescription] = useState(activity?.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  // With a single subject there is nothing to choose.
  const effectiveSubjectId = subjectId || (subjects.length === 1 ? subjects[0]!.id : '');

  const advancedInUse = Boolean(
    activity &&
    (activity.hasTime ||
      activity.description ||
      activity.type !== DEFAULT_ACTIVITY_TYPE ||
      activity.priority !== DEFAULT_ACTIVITY_PRIORITY),
  );

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

    if (activity) {
      const parsed = updateActivitySchema.safeParse({
        subjectId: effectiveSubjectId,
        title,
        dueDate,
        dueTime: dueTime || null,
        type,
        priority,
        status,
        description,
      });
      if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
      setFieldErrors({});
      update.mutate(
        { id: activity.id, input: parsed.data },
        { onSuccess: () => onSaved('Actividad actualizada.'), onError },
      );
    } else {
      const parsed = createActivitySchema.safeParse({
        subjectId: effectiveSubjectId,
        title,
        dueDate,
        dueTime: dueTime || undefined,
        type,
        priority,
        description,
      });
      if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
      setFieldErrors({});
      create.mutate(parsed.data, { onSuccess: () => onSaved('Actividad creada.'), onError });
    }
  }

  return (
    <Modal title={activity ? 'Editar actividad' : 'Agregar actividad'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormError>{formError}</FormError>}
        <FormField
          id="activity-title"
          label="Título"
          value={title}
          onChange={setTitle}
          error={fieldErrors.title?.[0]}
        />
        <SelectField
          id="activity-subject"
          label="Asignatura"
          placeholder={subjects.length === 1 ? undefined : 'Elige una asignatura'}
          value={effectiveSubjectId}
          onChange={setSubjectId}
          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
          error={fieldErrors.subjectId?.[0]}
        />
        {/* When it is edited, the state sits beside the date (two short controls on one row from 640 px). */}
        <div className={activity ? 'grid gap-4 sm:grid-cols-2' : undefined}>
          <FormField
            id="activity-date"
            label="Fecha"
            type="date"
            value={dueDate}
            onChange={setDueDate}
            error={fieldErrors.dueDate?.[0]}
          />
          {activity && (
            <SelectField
              id="activity-status"
              label="Estado"
              value={status}
              onChange={setStatus}
              options={ACTIVITY_STATUSES.map((s) => ({
                value: s,
                label: ACTIVITY_STATUS_LABELS[s],
              }))}
              error={fieldErrors.status?.[0]}
            />
          )}
        </div>

        <Disclosure summary="Más opciones" open={advancedInUse}>
          <FormField
            id="activity-time"
            label="Hora (opcional)"
            type="time"
            value={dueTime}
            onChange={setDueTime}
            error={fieldErrors.dueTime?.[0]}
            hint="Sin hora, vence al terminar el día."
          />
          {!activity && (
            <p className="text-sm text-muted-foreground">
              Los recordatorios se crean solos según el tipo; podrás ajustarlos al editar.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="activity-type"
              label="Tipo"
              value={type}
              onChange={setType}
              options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
              error={fieldErrors.type?.[0]}
            />
            <SelectField
              id="activity-priority"
              label="Prioridad"
              value={priority}
              onChange={setPriority}
              options={ACTIVITY_PRIORITIES.map((p) => ({
                value: p,
                label: ACTIVITY_PRIORITY_LABELS[p],
              }))}
              error={fieldErrors.priority?.[0]}
            />
          </div>
          <FormField
            id="activity-description"
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
            {pending ? 'Guardando…' : activity ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </FormActions>
      </form>
      {activity && <ReminderSection activity={activity} timeZone={timeZone} />}
    </Modal>
  );
}
