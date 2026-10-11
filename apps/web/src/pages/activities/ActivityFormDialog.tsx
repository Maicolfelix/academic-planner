import {
  ACTIVITY_DESCRIPTION_MAX,
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
import { useCurrentPeriod } from '../../academic/useAcademic';
import { useCreateActivity, useUpdateActivity } from '../../activities/useActivities';
import { ApiRequestError } from '../../api/client';
import { useMe } from '../../auth/useAuth';
import { readDraft, useDraftWriter } from '../../lib/drafts';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { Disclosure, FormActions, FormError } from '../../components/ui/form';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { FIELD_LABEL } from '../../components/ui/fieldStyles';
import { NO_SUBJECT_COLOR } from '../../lib/readableInk';
import { ReminderSection } from '../reminders/ReminderSection';
import {
  activityDraftSchema,
  activityDraftScope,
  isBlank,
  type ActivityDraft,
} from './activityDraft';
import { INLINE_SUBJECT_NAME_ID, InlineSubjectCreator } from './InlineSubjectCreator';

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
 *
 * "Crear asignatura" opens a small creator INLINE (not a nested dialog, not another page): everything typed in the
 * activity stays where it is, and the new subject is added to the options and selected. Nothing is created until the
 * student asks for it.
 *
 * What is typed is kept as a DRAFT in this browser (one for a new activity of the period, one per activity being edited):
 * closing the dialog, changing page or reloading loses nothing, and it is dropped only when the activity is saved or the
 * student discards it. An edit whose activity changed on the server meanwhile asks which version to keep.
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
  const { period } = useCurrentPeriod();

  // The wall-clock date/time come from core: the form never does timezone math itself.
  const local = activity ? toLocalParts(activity.dueAt, timeZone) : undefined;

  // What the form starts with when there is no draft; the draft (if any) replaces it, and equal to it means "nothing to keep".
  const [baseline] = useState<ActivityDraft>(() => ({
    title: activity?.title ?? '',
    subjectId:
      activity?.subjectId ??
      (defaultSubjectId && subjects.some((s) => s.id === defaultSubjectId) ? defaultSubjectId : ''),
    // A general activity opens as such; so does a new one when there is no subject to choose from.
    subjectless: activity ? activity.subjectId === null : subjects.length === 0,
    dueDate: local?.date ?? '',
    dueTime: activity?.hasTime && local ? local.time : '',
    type: activity?.type ?? DEFAULT_ACTIVITY_TYPE,
    priority: activity?.priority ?? DEFAULT_ACTIVITY_PRIORITY,
    status: activity?.status ?? 'PENDING',
    description: activity?.description ?? '',
    creatorName: null,
    base: activity?.updatedAt ?? null,
  }));

  // Coming back: the draft of this user (and period, or activity), read once when the form opens.
  const userId = useMe().data?.id;
  const scope = activityDraftScope(activity?.id, period?.id);
  const writer = useDraftWriter(userId, scope);
  const [stored] = useState(() => (userId ? readDraft(userId, scope, activityDraftSchema) : null));
  // The activity changed on the server since the draft began: the student chooses which version to keep.
  const [conflict, setConflict] = useState(
    Boolean(activity && stored && stored.payload.base !== activity.updatedAt),
  );
  const [start] = useState<ActivityDraft>(() => (stored && !conflict ? stored.payload : baseline));
  const restored = start !== baseline;

  const [title, setTitle] = useState(start.title);
  const [subjectId, setSubjectId] = useState(
    subjects.some((s) => s.id === start.subjectId) ? start.subjectId : baseline.subjectId,
  );
  const [dueDate, setDueDate] = useState(start.dueDate);
  const [dueTime, setDueTime] = useState(start.dueTime);
  const [type, setType] = useState<string>(start.type);
  const [priority, setPriority] = useState<string>(start.priority);
  const [status, setStatus] = useState<string>(start.status);
  const [description, setDescription] = useState(start.description);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  // Otherwise the subject is chosen (the usual flow) and omitting it is the student's decision.
  const [subjectless, setSubjectless] = useState(start.subjectless);
  // The swap between the selector and the state animates only once the student asks for it (not when the form opens).
  const [swapped, setSwapped] = useState(false);
  // Subjects created from this form: they are options at once, without waiting for the list to refresh.
  const [created, setCreated] = useState<Subject[]>([]);
  const [creating, setCreating] = useState(start.creatorName !== null);
  // The name typed in the inline creator so far (kept in the draft; nothing is created by keeping it).
  const [creatorName, setCreatorName] = useState(start.creatorName ?? '');
  // Said after selecting a subject the student already had instead of creating a duplicate.
  const [notice, setNotice] = useState<string>();
  const options = [...subjects, ...created.filter((c) => !subjects.some((s) => s.id === c.id))];

  // The control that was pressed disappears: keep the focus on the one that takes its place.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  // Whatever is typed or chosen is kept; nothing is written for a form that is still as it opened.
  const current: ActivityDraft = {
    title,
    subjectId,
    subjectless,
    dueDate,
    dueTime,
    type,
    priority,
    status,
    description,
    creatorName: creating ? creatorName : null,
    base: activity?.updatedAt ?? null,
  };
  const json = JSON.stringify(current);
  const baselineJson = JSON.stringify(baseline);
  const saved = useRef(JSON.stringify(start));
  useEffect(() => {
    if (json === saved.current) return;
    saved.current = json;
    const draft = JSON.parse(json) as ActivityDraft;
    writer.save(json === baselineJson || (!activity && isBlank(draft)) ? null : draft);
  }, [json, baselineJson, activity, writer]);
  const hasDraft = json !== baselineJson && (activity !== undefined || !isBlank(current));

  function applyValues(v: ActivityDraft) {
    setTitle(v.title);
    setSubjectId(subjects.some((s) => s.id === v.subjectId) ? v.subjectId : baseline.subjectId);
    setSubjectless(v.subjectless);
    setDueDate(v.dueDate);
    setDueTime(v.dueTime);
    setType(v.type);
    setPriority(v.priority);
    setStatus(v.status);
    setDescription(v.description);
    setCreating(v.creatorName !== null);
    setCreatorName(v.creatorName ?? '');
    setFieldErrors({});
    setFormError(undefined);
  }
  function discardDraft() {
    applyValues(baseline);
    writer.clear();
    saved.current = baselineJson;
  }

  const withoutSubjectError = () =>
    setFieldErrors((e) => {
      const rest = { ...e };
      delete rest.subjectId;
      return rest;
    });
  function omitSubject() {
    focusAfter.current = 'activity-subject-choose';
    withoutSubjectError();
    setNotice(undefined);
    setSwapped(true);
    setSubjectless(true);
  }
  function chooseSubject() {
    focusAfter.current = 'activity-subject';
    setSwapped(true);
    setSubjectless(false);
  }
  function openCreator() {
    setNotice(undefined);
    setFormError(undefined);
    setCreating(true); // the creator focuses its own name
  }
  function cancelCreator() {
    focusAfter.current = 'activity-subject-create';
    setCreating(false);
    setCreatorName(''); // cancelling leaves no trace: opening it again starts clean
  }
  /** The new (or already existing) subject becomes the selected one; the rest of the form is untouched. */
  function subjectCreated(subject: Subject, existing: boolean) {
    setCreated((all) => (all.some((s) => s.id === subject.id) ? all : [...all, subject]));
    setSubjectId(subject.id);
    setSubjectless(false);
    withoutSubjectError();
    setNotice(existing ? `Ya tenías «${subject.name}»: la seleccioné.` : undefined);
    setSwapped(true);
    setCreating(false);
    focusAfter.current = 'activity-subject';
  }

  // With a single subject there is nothing to choose.
  const effectiveSubjectId = subjectId || (options.length === 1 ? options[0]!.id : '');
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
    if (creating) {
      // The new subject is half made: finish or cancel it first (saving now would leave the subject undecided).
      setFormError('Termina de crear la asignatura o cancélala para guardar la actividad.');
      document.getElementById(INLINE_SUBJECT_NAME_ID)?.focus();
      return;
    }

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
        {
          onSuccess: () => {
            writer.clear();
            onSaved('Actividad actualizada.');
          },
          onError,
        },
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
      create.mutate(parsed.data, {
        onSuccess: () => {
          writer.clear();
          onSaved('Actividad creada.');
        },
        onError,
      });
    }
  }

  return (
    <Modal title={activity ? 'Editar actividad' : 'Agregar actividad'} onClose={onClose} keepsWork>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {conflict && stored && (
          <div
            role="group"
            aria-label="Esta actividad cambió"
            className="flex flex-col gap-2 rounded-control border border-warning-line bg-warning-soft p-3 text-sm text-warning-ink"
          >
            <p>Esta actividad cambió desde que empezaste a editarla. ¿Qué versión quieres?</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  applyValues(stored.payload);
                  setConflict(false);
                }}
              >
                Usar mi borrador
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  writer.clear();
                  setConflict(false);
                }}
              >
                Usar la versión actual
              </Button>
            </div>
          </div>
        )}
        {restored && hasDraft && (
          <p role="status" className="text-sm text-muted-foreground">
            Retomé lo que habías escrito.
          </p>
        )}
        {formError && <FormError>{formError}</FormError>}
        <FormField
          id="activity-title"
          label="Título"
          value={title}
          onChange={setTitle}
          error={fieldErrors.title?.[0]}
        />
        {creating ? (
          <InlineSubjectCreator
            subjects={options}
            periodId={period?.id ?? subjects[0]?.periodId}
            onCreated={subjectCreated}
            onCancel={cancelCreator}
            initialName={creatorName}
            onNameChange={setCreatorName}
          />
        ) : subjectless ? (
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
              <div className="-mr-2 flex flex-wrap items-center">
                {options.length > 0 && (
                  <Button
                    id="activity-subject-choose"
                    size="sm"
                    variant="ghost"
                    className="text-accent-ink"
                    onClick={chooseSubject}
                  >
                    Elegir asignatura
                  </Button>
                )}
                <Button
                  id="activity-subject-create"
                  size="sm"
                  variant="ghost"
                  className="text-accent-ink"
                  onClick={openCreator}
                >
                  Crear asignatura
                </Button>
              </div>
            </div>
            {options.length === 0 && (
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
              placeholder={options.length === 1 ? undefined : 'Elige una asignatura'}
              value={effectiveSubjectId}
              onChange={(value) => {
                setNotice(undefined);
                setSubjectId(value);
              }}
              options={options.map((s) => ({ value: s.id, label: s.name }))}
              error={fieldErrors.subjectId?.[0]}
            />
            {notice && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap gap-x-1">
              <Button size="sm" variant="ghost" className="text-accent-ink" onClick={omitSubject}>
                Omitir asignatura
              </Button>
              <Button
                id="activity-subject-create"
                size="sm"
                variant="ghost"
                className="text-accent-ink"
                onClick={openCreator}
              >
                Crear asignatura
              </Button>
            </div>
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
            label="Descripción (opcional)"
            placeholder="Añade contexto, instrucciones o algo que quieras recordar…"
            multiline
            maxLength={ACTIVITY_DESCRIPTION_MAX}
            value={description}
            onChange={setDescription}
            error={fieldErrors.description?.[0]}
          />
        </Disclosure>

        {hasDraft && (
          <p className="text-sm text-muted-foreground">
            Se guarda como borrador en este dispositivo.{' '}
            <button type="button" onClick={discardDraft} className="font-medium underline">
              Descartar borrador
            </button>
          </p>
        )}
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
