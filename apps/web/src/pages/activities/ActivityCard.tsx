import {
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
  calculateRadarStatus,
  formatDue,
  radarExplanation,
  type Activity,
  type ActivityStatus,
  type Subject,
} from '@planner/core';
import { RadarBadge } from '../radar/RadarBadge';
import { PriorityBadge, StatusBadge, TypeBadge } from './badges';

interface Props {
  activity: Activity;
  subject: Subject | undefined;
  timeZone: string;
  now: Date;
  statusPending: boolean;
  onStatusChange: (status: ActivityStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const button = 'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100';

/** One activity: what it is, when it is due, and its state — plus the quick actions. */
export function ActivityCard({
  activity,
  subject,
  timeZone,
  now,
  statusPending,
  onStatusChange,
  onEdit,
  onDelete,
}: Props) {
  // Derived from the clock on every render (see core/radar.ts): null for a finished activity.
  const radar = calculateRadarStatus(activity, now);
  const done = activity.status === 'COMPLETED';

  return (
    <li className="flex min-w-0 overflow-hidden rounded-lg border border-slate-300">
      <span
        aria-hidden="true"
        style={{ backgroundColor: subject?.color ?? '#64748B' }}
        className="w-2 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <h2 className={`font-semibold break-words ${done ? 'text-slate-600 line-through' : ''}`}>
            {activity.title}
          </h2>
          {subject && <p className="text-sm text-slate-700 break-words">{subject.name}</p>}
          <p className="text-sm text-slate-700">
            {formatDue(activity, timeZone)}
            {radar && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-medium">{radarExplanation(activity, now, timeZone)}</span>
              </>
            )}
          </p>
          {activity.description && (
            <p className="mt-1 line-clamp-2 text-sm text-slate-600 break-words">
              {activity.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {radar && <RadarBadge status={radar} />}
          <StatusBadge status={activity.status} />
          <PriorityBadge priority={activity.priority} />
          <TypeBadge type={activity.type} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Cambiar estado de ${activity.title}`}
            value={activity.status}
            disabled={statusPending}
            onChange={(e) => onStatusChange(e.target.value as ActivityStatus)}
            className="min-h-11 rounded-md border border-slate-400 bg-white px-2 py-2 text-sm"
          >
            {ACTIVITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACTIVITY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Editar ${activity.title}`}
            onClick={onEdit}
            className={button}
          >
            Editar
          </button>
          <button
            type="button"
            aria-label={`Eliminar ${activity.title}`}
            onClick={onDelete}
            className={`${button} text-red-800`}
          >
            Eliminar
          </button>
        </div>
      </div>
    </li>
  );
}
