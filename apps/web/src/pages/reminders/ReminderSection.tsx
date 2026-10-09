import {
  REMINDER_STATUS_LABELS,
  fieldErrorsOf,
  formatDue,
  formatReminderOffset,
  toLocalParts,
  updateReminderSchema,
  type Activity,
  type Reminder,
} from '@planner/core';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import {
  useActivityReminders,
  useCreateReminder,
  useDeleteReminder,
  useUpdateReminder,
} from '../../reminders/useReminders';

const when = (r: Reminder, timeZone: string) =>
  formatDue({ dueAt: r.remindAt, hasTime: true }, timeZone);

interface EditorProps {
  initial?: { date: string; time: string };
  submitLabel: string;
  pending: boolean;
  error?: string;
  onSubmit: (v: { remindDate: string; remindTime: string }) => void;
  onCancel: () => void;
}

/** Date + time of one reminder. Whether it lies in the future and before the deadline is decided by the server. */
function ReminderEditor({ initial, submitLabel, pending, error, onSubmit, onCancel }: EditorProps) {
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = updateReminderSchema.safeParse({ remindDate: date, remindTime: time });
    if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
    setFieldErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex animate-rise flex-col gap-3 rounded-control border border-border bg-surface p-3"
    >
      <FormField
        id="reminder-date"
        label="Fecha del recordatorio"
        type="date"
        value={date}
        onChange={setDate}
        error={fieldErrors.remindDate?.[0]}
      />
      <FormField
        id="reminder-time"
        label="Hora del recordatorio"
        type="time"
        value={time}
        onChange={setTime}
        error={fieldErrors.remindTime?.[0] ?? error}
      />
      <FormActions>
        <Button size="sm" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button size="sm" type="submit" variant="primary" disabled={pending}>
          {pending ? 'Guardando…' : submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}

/**
 * Reminders of ONE activity, inside its edit dialog. Automatic ones are listed with their rule
 * ("1 día antes"); editing one turns it into a manual reminder. The text shown on the Dashboard
 * is not stored: it is derived from the activity.
 */
export function ReminderSection({ activity, timeZone }: { activity: Activity; timeZone: string }) {
  const list = useActivityReminders(activity.id);
  const create = useCreateReminder();
  const update = useUpdateReminder();
  const remove = useDeleteReminder();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [error, setError] = useState<string>();

  const finished = activity.status === 'COMPLETED';
  const serverMessage = (err: Error) =>
    err instanceof ApiRequestError && err.fieldErrors.remindTime?.[0]
      ? err.fieldErrors.remindTime[0]
      : err.message;

  return (
    <section
      aria-labelledby="reminders-heading"
      className="mt-5 flex flex-col gap-3 rounded-surface border border-border bg-secondary/40 p-3"
    >
      {/* The section is part of the form's surface: its title on the left and the way to add one on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="reminders-heading" className="text-base font-semibold">
          Recordatorios
        </h3>
        {!finished && !adding && (
          <Button
            size="sm"
            variant="ghost"
            className="font-semibold text-accent-ink"
            onClick={() => {
              setError(undefined);
              setEditingId(undefined);
              setAdding(true);
            }}
          >
            + Agregar recordatorio
          </Button>
        )}
      </div>

      {list.isPending && <p role="status">Cargando recordatorios…</p>}
      {list.isError && (
        <FormError>No se pudieron cargar los recordatorios: {list.error.message}</FormError>
      )}

      {list.data && list.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Esta actividad no tiene recordatorios{finished ? '.' : ' pendientes.'}
        </p>
      )}

      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.data.map((r) => {
            const local = toLocalParts(r.remindAt, timeZone);
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold">{when(r, timeZone)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-muted-foreground">
                    {r.kind === 'AUTO' && r.offsetMinutes !== null
                      ? `Automático, ${formatReminderOffset(r.offsetMinutes)}`
                      : 'Manual'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-muted-foreground">{REMINDER_STATUS_LABELS[r.status]}</span>
                </div>
                {editingId === r.id ? (
                  <ReminderEditor
                    initial={{ date: local.date, time: local.time }}
                    submitLabel="Guardar recordatorio"
                    pending={update.isPending}
                    error={error}
                    onCancel={() => setEditingId(undefined)}
                    onSubmit={(input) => {
                      setError(undefined);
                      update.mutate(
                        { id: r.id, input },
                        {
                          onSuccess: () => setEditingId(undefined),
                          onError: (err) => setError(serverMessage(err)),
                        },
                      );
                    }}
                  />
                ) : (
                  !finished && (
                    <div className="-mb-1 flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar recordatorio del ${when(r, timeZone)}`}
                        onClick={() => {
                          setError(undefined);
                          setAdding(false);
                          setEditingId(r.id);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        disabled={remove.isPending}
                        aria-label={`Eliminar recordatorio del ${when(r, timeZone)}`}
                        onClick={() => remove.mutate(r.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {remove.isError && <FormError>{remove.error.message}</FormError>}

      {finished ? (
        <p className="text-sm text-muted-foreground">
          La actividad está finalizada: no admite recordatorios nuevos. Si la reabres, se vuelven a
          generar los automáticos que aún estén en el futuro.
        </p>
      ) : adding ? (
        <ReminderEditor
          submitLabel="Agregar"
          pending={create.isPending}
          error={error}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            setError(undefined);
            create.mutate(
              { activityId: activity.id, ...input },
              {
                onSuccess: () => setAdding(false),
                onError: (err) => setError(serverMessage(err)),
              },
            );
          }}
        />
      ) : null}
    </section>
  );
}
