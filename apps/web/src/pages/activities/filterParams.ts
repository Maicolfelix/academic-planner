import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  RADAR_STATUSES,
  type ActivityPriority,
  type ActivityStatus,
  type ActivityType,
  type RadarStatus,
} from '@planner/core';
import type { ActivityQuery } from '../../api/activities';

/** The filters the page shows. They live in the URL so a filtered view can be shared and survives reload. */
export interface ActivityFilters {
  status?: ActivityStatus;
  /** "Vencidas": derived by the backend (deadline passed and not finished). Exclusive with `status`. */
  overdue?: boolean;
  subject?: string;
  priority?: ActivityPriority;
  type?: ActivityType;
  /** Radar category: derived from the deadline by the backend (open activities only). */
  radar?: RadarStatus;
}

const pick = <T extends string>(values: readonly T[], raw: string | null): T | undefined =>
  values.find((v) => v === raw);

/** Unknown or tampered values in the URL are ignored, never sent to the API. */
export function parseFilters(params: URLSearchParams): ActivityFilters {
  const overdue = params.get('overdue') === 'true';
  return {
    ...(overdue ? { overdue: true } : { status: pick(ACTIVITY_STATUSES, params.get('status')) }),
    subject: params.get('subject') || undefined,
    priority: pick(ACTIVITY_PRIORITIES, params.get('priority')),
    type: pick(ACTIVITY_TYPES, params.get('type')),
    radar: pick(RADAR_STATUSES, params.get('radar')),
  };
}

export function serializeFilters(filters: ActivityFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.overdue) params.set('overdue', 'true');
  else if (filters.status) params.set('status', filters.status);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.type) params.set('type', filters.type);
  if (filters.radar) params.set('radar', filters.radar);
  return params;
}

export const hasActiveFilters = (f: ActivityFilters) =>
  Boolean(f.status || f.overdue || f.subject || f.priority || f.type || f.radar);

export function toApiQuery(filters: ActivityFilters, periodId: string | undefined): ActivityQuery {
  return {
    periodId,
    subjectId: filters.subject,
    status: filters.status,
    priority: filters.priority,
    type: filters.type,
    overdue: filters.overdue ? true : undefined,
    radar: filters.radar,
  };
}
