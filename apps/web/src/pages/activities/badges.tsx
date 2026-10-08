import {
  ACTIVITY_PRIORITY_LABELS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPE_LABELS,
  type ActivityPriority,
  type ActivityStatus,
  type ActivityType,
} from '@planner/core';
import { Badge, type BadgeTone } from '../../components/ui/Badge';

// Every badge carries text AND a shape/symbol: meaning never depends on color alone.
const PRIORITY_STYLE: Record<ActivityPriority, { symbol: string; tone: BadgeTone }> = {
  HIGH: { symbol: '▲', tone: 'danger' },
  MEDIUM: { symbol: '●', tone: 'warning' },
  LOW: { symbol: '▽', tone: 'neutral' },
};

const STATUS_STYLE: Record<ActivityStatus, { symbol: string; tone: BadgeTone }> = {
  PENDING: { symbol: '○', tone: 'neutral' },
  IN_PROGRESS: { symbol: '◐', tone: 'info' },
  COMPLETED: { symbol: '✓', tone: 'success' },
};

export function PriorityBadge({ priority }: { priority: ActivityPriority }) {
  const { symbol, tone } = PRIORITY_STYLE[priority];
  return (
    <Badge tone={tone}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">Prioridad </span>
      {ACTIVITY_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: ActivityStatus }) {
  const { symbol, tone } = STATUS_STYLE[status];
  return (
    <Badge tone={tone}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">Estado </span>
      {ACTIVITY_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TypeBadge({ type }: { type: ActivityType }) {
  return (
    <Badge>
      <span className="sr-only">Tipo </span>
      {ACTIVITY_TYPE_LABELS[type]}
    </Badge>
  );
}

/** A derived condition, not a status: the underlying status stays Pendiente / En proceso. */
export function OverdueBadge() {
  return (
    <Badge tone="critical">
      <span aria-hidden="true">⚠</span>
      Vencida
    </Badge>
  );
}
