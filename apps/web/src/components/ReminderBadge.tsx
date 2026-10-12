import { BellIcon } from './ui/icons';

/**
 * How many reminders are due, on the "Inicio" link: a small circle (a number, never longer than it needs) pinned to the
 * corner of the icon, with a ring in the bar's color so it reads as separate from the icon it sits next to. From `lg`, where
 * the link is icon + label in a row, it sits after the label with a small bell. The number is decoration for sighted
 * users: the link's name carries the same information ("2 recordatorios"), so it is never the only signal.
 */
export function ReminderBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      data-reminder-badge
      className="absolute top-1 left-1/2 ml-2.5 inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full border border-warning-line bg-warning-soft px-1 text-[11px] leading-none font-semibold text-warning-ink ring-2 ring-surface lg:static lg:ml-0 lg:px-2 lg:text-xs lg:ring-0"
    >
      <BellIcon className="hidden size-3.5 lg:block" />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">
        {count} {count === 1 ? 'recordatorio' : 'recordatorios'}
      </span>
    </span>
  );
}
