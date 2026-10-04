import type { Activity, ActivityStatus, Subject } from '@planner/core';
import { ActivityCard } from './ActivityCard';

interface Props {
  activities: Activity[];
  subjects: Subject[];
  timeZone: string;
  now: Date;
  /** Id of the activity whose status is being saved, to disable only its control. */
  pendingStatusId: string | undefined;
  onStatusChange: (activity: Activity, status: ActivityStatus) => void;
  onEdit: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
}

/** Open activities first (soonest deadline first, as the API returns them), finished ones after. */
export function ActivityList({
  activities,
  subjects,
  timeZone,
  now,
  pendingStatusId,
  onStatusChange,
  onEdit,
  onDelete,
}: Props) {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const ordered = [
    ...activities.filter((a) => a.status !== 'COMPLETED'),
    ...activities.filter((a) => a.status === 'COMPLETED'),
  ];

  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((activity) => (
        <ActivityCard
          key={activity.id}
          activity={activity}
          subject={subjectById.get(activity.subjectId)}
          timeZone={timeZone}
          now={now}
          statusPending={pendingStatusId === activity.id}
          onStatusChange={(status) => onStatusChange(activity, status)}
          onEdit={() => onEdit(activity)}
          onDelete={() => onDelete(activity)}
        />
      ))}
    </ul>
  );
}
