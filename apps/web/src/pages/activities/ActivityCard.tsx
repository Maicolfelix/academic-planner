import {
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPE_LABELS,
  calculateRadarStatus,
  formatDue,
  radarExplanation,
  type Activity,
  type ActivityStatus,
  type RadarStatus,
  type Subject,
} from '@planner/core';
import { useMutation } from '@tanstack/react-query';
import { downloadActivityCalendar } from '../../api/activities';
import { useJustCompleted } from '../../lib/useJustCompleted';
import { withAlpha } from '../../lib/readableInk';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import {
  CalendarPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  TrashIcon,
} from '../../components/ui/icons';
import { RadarBadge } from '../radar/RadarBadge';
import { PriorityBadge } from './badges';

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

/** The status control keeps the state's own tone and a symbol, so it reads as a state and never as color alone. */
const STATUS_PILL: Record<ActivityStatus, { symbol: string; tone: string }> = {
  PENDING: { symbol: '○', tone: 'border-border-strong bg-surface text-foreground' },
  IN_PROGRESS: { symbol: '◐', tone: 'border-info-line bg-info-soft text-info-ink' },
  COMPLETED: { symbol: '✓', tone: 'border-success-line bg-success-soft text-success-ink' },
};

/** Cards that need a second look get a thin tinted edge; the rest rest on the neutral one. Never a rainbow. */
const URGENT: RadarStatus[] = ['OVERDUE', 'IMMEDIATE'];

/**
 * One activity, in the order a student reads it: WHAT (title, with its state on the right), WHEN (subject and
 * deadline), HOW URGENT (Radar mark and priority; the type is quiet metadata), and then the actions:
 * ONE primary ("Completar", the same change as choosing "Finalizada" in the state control; a tonal button, because a
 * list of twelve solid dark buttons would be twelve things shouting) and "Editar" within reach,
 * with the rest ("Añadir al calendario", "Eliminar") one tap away in a menu. A finished activity has no primary action:
 * it rests on a quieter surface. Nothing here loops or animates continuously: a list can be long.
 */
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
  // A brief confirmation (a soft success tint, a check and a popping state control) the moment it becomes completed.
  const justCompleted = useJustCompleted(activity.status);
  // Read-only: nothing to invalidate. The browser/OS decides what opens the downloaded file.
  const addToCalendar = useMutation({ mutationFn: () => downloadActivityCalendar(activity.id) });
  const color = subject?.color ?? '#64748B';
  const pill = STATUS_PILL[activity.status];

  return (
    <Card
      as="li"
      variant={done ? 'soft' : 'solid'}
      data-just-completed={justCompleted || undefined}
      style={{
        backgroundImage: `radial-gradient(130% 70% at 0% 0%, ${withAlpha(color, 0.1)}, transparent 60%)`,
      }}
      className={`relative flex min-w-0 flex-col gap-2 p-3 pl-4 transition-shadow duration-(--duration-fast) ease-standard hover:shadow-lift ${
        radar && URGENT.includes(radar) ? 'border-danger-line' : ''
      } ${justCompleted ? 'animate-complete' : ''}`}
    >
      {/* The subject's color as a thin, inset rail (not a slab down the edge): a mark that says "this subject". */}
      <span
        aria-hidden="true"
        style={{ backgroundColor: color }}
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
      />

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className={`text-card-title break-words ${done ? 'text-muted-foreground line-through' : ''}`}
          >
            {justCompleted && (
              <span
                aria-hidden="true"
                className="mr-1.5 inline-grid size-5 animate-pop place-items-center rounded-full bg-success align-text-bottom text-primary-foreground"
              >
                <CheckIcon className="size-3.5" />
              </span>
            )}
            {activity.title}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            {subject && (
              <>
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: color }}
                  className="size-2 shrink-0 rounded-full"
                />
                <span className="min-w-0 break-words">{subject.name}</span>
              </>
            )}
          </p>
        </div>

        {/* The state control: still a native <select> (the best picker on every phone), dressed as the state itself.
            It keeps the same name and the same three states as before; only its look changed. */}
        <span className={`relative shrink-0 ${justCompleted ? 'animate-pop' : ''}`}>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm"
          >
            {pill.symbol}
          </span>
          <select
            aria-label={`Cambiar estado de ${activity.title}`}
            value={activity.status}
            disabled={statusPending}
            onChange={(e) => onStatusChange(e.target.value as ActivityStatus)}
            className={`min-h-11 w-[8.25rem] cursor-pointer appearance-none rounded-full border py-2 pr-8 pl-8 text-sm font-medium transition-colors duration-(--duration-fast) ease-standard disabled:opacity-60 ${pill.tone}`}
          >
            {ACTIVITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACTIVITY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-70" />
        </span>
      </div>

      <p className="text-sm text-foreground">
        {formatDue(activity, timeZone)}
        {radar && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {' '}
              ·{' '}
            </span>
            <span className="font-semibold">{radarExplanation(activity, now, timeZone)}</span>
          </>
        )}
      </p>

      {activity.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground break-words">
          {activity.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {radar && <RadarBadge status={radar} />}
        <PriorityBadge priority={activity.priority} />
        {/* The type is metadata: quiet text, not another pill. */}
        <span className="px-1 text-xs text-muted-foreground">
          <span className="sr-only">Tipo </span>
          {ACTIVITY_TYPE_LABELS[activity.type]}
        </span>
      </div>

      <div className="-mb-1 mt-auto flex items-center gap-1 pt-0.5">
        {!done && (
          <Button
            size="sm"
            aria-label={`Completar ${activity.title}`}
            disabled={statusPending}
            onClick={() => onStatusChange('COMPLETED')}
            className="gap-1.5 border border-accent/40 bg-accent-soft text-accent-ink hover:bg-accent/15"
          >
            <CheckIcon />
            Completar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Editar ${activity.title}`}
          onClick={onEdit}
          className="gap-1.5"
        >
          <PencilIcon />
          Editar
        </Button>
        <span className="ml-auto">
          <ActionMenu
            label={`Más acciones: ${activity.title}`}
            items={[
              {
                label: 'Añadir al calendario',
                ariaLabel: `Añadir al calendario: ${activity.title}`,
                icon: <CalendarPlusIcon />,
                disabled: addToCalendar.isPending,
                onSelect: () => addToCalendar.mutate(),
              },
              {
                label: 'Eliminar',
                ariaLabel: `Eliminar ${activity.title}`,
                icon: <TrashIcon />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          />
        </span>
      </div>

      {addToCalendar.isError && (
        <p role="alert" className="text-sm text-danger-ink break-words">
          No se pudo descargar el archivo del calendario. Inténtalo de nuevo.
        </p>
      )}
    </Card>
  );
}
