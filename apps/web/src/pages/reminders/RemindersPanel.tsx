import { DUE_REMINDERS_LIMIT, reminderMessage } from '@planner/core';
import { OriginLabel } from '../../components/OriginLabel';
import { buttonStyles } from '../../components/ui/buttonStyles';
import { PIXELS, PixelIcon, TickIcon } from '../../components/ui/icons';
import { useOrigins } from '../../academic/useAcademic';
import { useDueReminders, useMarkSeen } from '../../reminders/useReminders';

/**
 * One compact card on the Dashboard with the reminders that are due now. It is not a stack of
 * modals: each row can be dismissed ("Visto") or all at once. Nothing is marked as seen just by
 * loading the page — only the student's click does it.
 *
 * The look: a warm card with a pixel bell that swings once when it appears, a count pill, and one row per reminder with its own
 * bell tile and a rail down the edge (red when the deadline has already passed, amber when it is still coming), the subject
 * as a colored dot and "Visto" as a small button with a pixel tick. The rows arrive one after another. The words say
 * everything (the message already says "venció" or "vence"); the rail and the tile only accompany them.
 */
export function RemindersPanel({ timeZone, now }: { timeZone: string; now: Date }) {
  const due = useDueReminders();
  const markSeen = useMarkSeen();
  const originOf = useOrigins();
  if (!due.data || due.data.total === 0) return null;

  const { reminders, total } = due.data;
  const hidden = total - reminders.length;
  const ids = reminders.map((r) => r.id);

  return (
    <section
      aria-labelledby="reminders-panel-heading"
      className="relative flex flex-col gap-3 overflow-hidden rounded-surface border border-warning-line bg-[linear-gradient(160deg,var(--warning-soft),var(--surface)_130%)] p-4 shadow-card"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#f59e0b,#fb7185_60%,transparent)]"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,#f59e0b,#ea580c)] text-white shadow-[3px_3px_0_0_rgb(180_83_9/0.25),inset_0_2px_0_rgb(255_255_255/0.3)]"
          >
            <PixelIcon rows={PIXELS.bell} className="size-6 origin-top motion-safe:animate-bell" />
          </span>
          <h2 id="reminders-panel-heading" className="text-section-title before:hidden">
            Recordatorios
          </h2>
        </div>
        <p className="rounded-full border border-warning-line bg-surface/80 px-3 py-1 text-sm font-semibold text-warning-ink">
          Tienes {total} {total === 1 ? 'recordatorio' : 'recordatorios'}
        </p>
      </div>
      <ul className="stagger flex flex-col gap-2">
        {reminders.map((r) => {
          const late = new Date(r.activity.dueAt).getTime() < now.getTime();
          return (
            <li
              key={r.id}
              className="relative flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-control border border-border bg-surface py-3 pr-3 pl-5 shadow-card"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-1.5 ${late ? 'bg-danger' : 'bg-warning'}`}
              />
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${late ? 'bg-danger-soft text-danger-ink' : 'bg-warning-soft text-warning-ink'}`}
                >
                  <PixelIcon rows={PIXELS.bell} className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {reminderMessage(r.activity, now, timeZone)}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm break-words text-muted-foreground">
                    {r.subject && (
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: r.subject.color }}
                        className="size-2 shrink-0 rounded-full"
                      />
                    )}
                    <span>
                      {r.subject?.name ?? 'Sin asignatura'}
                      <OriginLabel label={originOf(r.activity.periodId)} />
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={markSeen.isPending}
                onClick={() => markSeen.mutate([r.id])}
                aria-label={`Marcar como visto: ${r.activity.title}`}
                className={buttonStyles({ size: 'sm', className: 'gap-1.5 disabled:opacity-60' })}
              >
                <TickIcon className="size-4" />
                Visto
              </button>
            </li>
          );
        })}
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
          className={buttonStyles({
            size: 'sm',
            className: 'gap-2 self-start disabled:opacity-60',
          })}
        >
          <TickIcon className="size-4" />
          Marcar todos como vistos
        </button>
      )}
    </section>
  );
}
