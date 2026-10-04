import { DUE_REMINDERS_LIMIT, reminderMessage } from '@planner/core';
import { useDueReminders, useMarkSeen } from '../../reminders/useReminders';

/**
 * One compact card on the Dashboard with the reminders that are due now. It is not a stack of
 * modals: each row can be dismissed ("Visto") or all at once. Nothing is marked as seen just by
 * loading the page — only the student's click does it.
 */
export function RemindersPanel({ timeZone, now }: { timeZone: string; now: Date }) {
  const due = useDueReminders();
  const markSeen = useMarkSeen();
  if (!due.data || due.data.total === 0) return null;

  const { reminders, total } = due.data;
  const hidden = total - reminders.length;
  const ids = reminders.map((r) => r.id);

  return (
    <section
      aria-labelledby="reminders-panel-heading"
      className="flex flex-col gap-3 rounded-lg border border-amber-500 bg-amber-50 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reminders-panel-heading" className="text-lg font-semibold">
          Recordatorios
        </h2>
        <p className="text-sm font-medium">
          Tienes {total} {total === 1 ? 'recordatorio' : 'recordatorios'}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {reminders.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="break-words">
                <span aria-hidden="true">🔔 </span>
                {reminderMessage(r.activity, now, timeZone)}
              </p>
              <p className="text-sm break-words text-slate-700">{r.subject.name}</p>
            </div>
            <button
              type="button"
              disabled={markSeen.isPending}
              onClick={() => markSeen.mutate([r.id])}
              aria-label={`Marcar como visto: ${r.activity.title}`}
              className="min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-60"
            >
              Visto
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="text-sm">
          Mostrando {reminders.length} de {total} (máximo {DUE_REMINDERS_LIMIT} a la vez); al
          marcarlos verás el resto.
        </p>
      )}
      {markSeen.isError && (
        <p role="alert" className="text-sm text-red-800">
          No se pudo marcar: {markSeen.error.message}
        </p>
      )}
      {reminders.length > 1 && (
        <button
          type="button"
          disabled={markSeen.isPending}
          onClick={() => markSeen.mutate(ids)}
          className="min-h-11 self-start rounded-md border border-slate-400 bg-white px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-60"
        >
          Marcar todos como vistos
        </button>
      )}
    </section>
  );
}
