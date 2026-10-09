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
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCreateActivity, useUpdateActivity } from '../../activities/useActivities';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { Disclosure, FormActions, FormError } from '../../components/ui/form';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { NO_SUBJECT_COLOR } from '../../lib/readableInk';
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
 *
 * The subject is optional (F1): "Omitir asignatura" turns the selector into the state "Sin asignatura" (a general
 * activity, e.g. an errand or a meeting) and "Elegir asignatura" brings the selector back. It is never the default when
 * there are subjects: it takes one explicit tap. The last subject chosen is kept while the form is open, so going
 * back and forth does not lose it. Saving in the "Sin asignatura" state sends `subjectId: null`.
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

  // A general activity opens as such; so does a new one when there is no subject to choose from. Otherwise the subject
  // is chosen (the usual flow) and omitting it is the student's decision.
  const [subjectless, setSubjectless] = useState(
    activity ? activity.subjectId === null : subjects.length === 0,
  );
  // The swap between the selector and the state animates only once the student asks for it (not when the form opens).
  const [swapped, setSwapped] = useState(false);
  const focusAfterSwap = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAfterSwap.current) return;
    document.getElementById(focusAfterSwap.current)?.focus();
    focusAfterSwap.current = null;
  }, [subjectless]);

  // The control that was pressed disappears: keep the focus on the one that takes its place.
  function omitSubject() {
    focusAfterSwap.current = 'activity-subject-choose';
    setFieldErrors((e) => {
      const rest = { ...e };
      delete rest.subjectId;
      return rest;
    });
    setSwapped(true);
    setSubjectless(true);
  }
  function chooseSubject() {
    focusAfterSwap.current = 'activity-subject';
    setSwapped(true);
    setSubjectless(false);
  }

  // With a single subject there is nothing to choose.
  const effectiveSubjectId = subjectId || (subjects.length === 1 ? subjects[0]!.id : '');
  const subjectToSend = subjectless ? null : effectiveSubjectId;

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
        subjectId: subjectToSend,
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
        subjectId: subjectToSend,
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
        {subjectless ? (
          <div
            role="group"
            aria-labelledby="activity-subject-label"
            className={`flex flex-col gap-1.5 ${swapped ? 'animate-rise' : ''}`}
          >
            <span id="activity-subject-label" className={FIELD_LABEL}>
              Asignatura
            </span>
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-control border border-dashed border-border-strong px-3 py-1">
              <p id="activity-subject-none" className="flex items-center gap-2 text-foreground">
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: NO_SUBJECT_COLOR }}
                  className="size-2 shrink-0 rounded-full"
                />
                Sin asignatura
              </p>
              {subjects.length > 0 && (
                <Button
                  id="activity-subject-choose"
                  size="sm"
                  variant="ghost"
                  className="-mr-2 text-accent-ink"
                  onClick={chooseSubject}
                >
                  Elegir asignatura
                </Button>
              )}
            </div>
            {subjects.length === 0 && (
              <p className="text-sm text-muted-foreground">Aún no tienes asignaturas.</p>
            )}
            {fieldErrors.subjectId?.[0] && (
              <p role="alert" className="text-sm text-danger-ink">
                {fieldErrors.subjectId[0]}
              </p>
            )}
          </div>
        ) : (
          <div className={`flex flex-col gap-0.5 ${swapped ? 'animate-rise' : ''}`}>
            <SelectField
              id="activity-subject"
              label="Asignatura"
              placeholder={subjects.length === 1 ? undefined : 'Elige una asignatura'}
              value={effectiveSubjectId}
              onChange={setSubjectId}
              options={subjects.map((s) => ({ value: s.id, label: s.name }))}
              error={fieldErrors.subjectId?.[0]}
            />
            <Button
              size="sm"
              variant="ghost"
              className="self-start text-accent-ink"
              onClick={omitSubject}
            >
              Omitir asignatura
            </Button>
          </div>
        )}
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
