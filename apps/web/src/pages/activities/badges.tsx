import {
  ACTIVITY_PRIORITY_LABELS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPE_LABELS,
  type ActivityPriority,
  type ActivityStatus,
  type ActivityType,
} from '@planner/core';

const base = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium';

// Every badge carries text AND a shape/symbol: meaning never depends on color alone.
const PRIORITY_STYLE: Record<ActivityPriority, { symbol: string; className: string }> = {
  HIGH: { symbol: '▲', className: 'border-red-300 bg-red-50 text-red-900' },
  MEDIUM: { symbol: '●', className: 'border-amber-300 bg-amber-50 text-amber-900' },
  LOW: { symbol: '▽', className: 'border-slate-300 bg-slate-50 text-slate-800' },
};

const STATUS_STYLE: Record<ActivityStatus, { symbol: string; className: string }> = {
  PENDING: { symbol: '○', className: 'border-slate-300 bg-white text-slate-800' },
  IN_PROGRESS: { symbol: '◐', className: 'border-blue-300 bg-blue-50 text-blue-900' },
  COMPLETED: { symbol: '✓', className: 'border-green-300 bg-green-50 text-green-900' },
};

export function PriorityBadge({ priority }: { priority: ActivityPriority }) {
  const { symbol, className } = PRIORITY_STYLE[priority];
  return (
    <span className={`${base} ${className}`}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">Prioridad </span>
      {ACTIVITY_PRIORITY_LABELS[priority]}
    </span>
  );
}

export function StatusBadge({ status }: { status: ActivityStatus }) {
  const { symbol, className } = STATUS_STYLE[status];
  return (
    <span className={`${base} ${className}`}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">Estado </span>
      {ACTIVITY_STATUS_LABELS[status]}
    </span>
  );
}

export function TypeBadge({ type }: { type: ActivityType }) {
  return (
    <span className={`${base} border-slate-300 bg-white text-slate-800`}>
      <span className="sr-only">Tipo </span>
      {ACTIVITY_TYPE_LABELS[type]}
    </span>
  );
}

/** A derived condition, not a status: the underlying status stays Pendiente / En proceso. */
export function OverdueBadge() {
  return (
    <span className={`${base} border-red-700 bg-red-700 text-white`}>
      <span aria-hidden="true">⚠</span>
      Vencida
    </span>
  );
}
