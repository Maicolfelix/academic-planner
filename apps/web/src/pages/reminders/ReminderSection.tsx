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
import {
  useActivityReminders,
  useCreateReminder,
  useDeleteReminder,
  useUpdateReminder,
} from '../../reminders/useReminders';

const smallButton =
  'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-60';

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
      className="flex flex-col gap-3 rounded-md border border-slate-300 p-3"
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
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className={smallButton}>
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {pending ? 'Guardando…' : submitLabel}
        </button>
      </div>
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
    <section aria-labelledby="reminders-heading" className="mt-5 flex flex-col gap-3 border-t pt-4">
      <h3 id="reminders-heading" className="text-base font-semibold">
        Recordatorios
      </h3>

      {list.isPending && <p role="status">Cargando recordatorios…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-800">
          No se pudieron cargar los recordatorios: {list.error.message}
        </p>
      )}

      {list.data && list.data.length === 0 && (
        <p className="text-sm text-slate-700">
          Esta actividad no tiene recordatorios{finished ? '.' : ' pendientes.'}
        </p>
      )}

      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.data.map((r) => {
            const local = toLocalParts(r.remindAt, timeZone);
            return (
              <li key={r.id} className="flex flex-col gap-2 rounded-md border border-slate-300 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">{when(r, timeZone)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {r.kind === 'AUTO' && r.offsetMinutes !== null
                      ? `Automático, ${formatReminderOffset(r.offsetMinutes)}`
                      : 'Manual'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{REMINDER_STATUS_LABELS[r.status]}</span>
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={smallButton}
                        aria-label={`Editar recordatorio del ${when(r, timeZone)}`}
                        onClick={() => {
                          setError(undefined);
                          setAdding(false);
                          setEditingId(r.id);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        disabled={remove.isPending}
                        aria-label={`Eliminar recordatorio del ${when(r, timeZone)}`}
                        onClick={() => remove.mutate(r.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-red-800">
          {remove.error.message}
        </p>
      )}

      {finished ? (
        <p className="text-sm text-slate-700">
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
      ) : (
        <button
          type="button"
          className={`${smallButton} self-start`}
          onClick={() => {
            setError(undefined);
            setEditingId(undefined);
            setAdding(true);
          }}
        >
          + Agregar recordatorio
        </button>
      )}
    </section>
  );
}
