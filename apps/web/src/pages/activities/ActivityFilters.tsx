import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_PRIORITY_LABELS,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  RADAR_GROUP_LABELS,
  RADAR_STATUSES,
  type ActivityStatus,
  type Subject,
} from '@planner/core';
import { SelectField } from '../../components/SelectField';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useSlidingIndicator } from '../../lib/useSlidingIndicator';
import { hasActiveFilters, type ActivityFilters as Filters } from './filterParams';

type View = 'all' | ActivityStatus | 'overdue';

const VIEWS: { value: View; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'IN_PROGRESS', label: 'En proceso' },
  { value: 'COMPLETED', label: 'Finalizadas' },
  { value: 'overdue', label: 'Vencidas' },
];

const currentView = (f: Filters): View => (f.overdue ? 'overdue' : (f.status ?? 'all'));

interface Props {
  filters: Filters;
  subjects: Subject[];
  onChange: (filters: Filters) => void;
}

/** Quick state chips plus three selectors. Everything is a native control: keyboard works for free. */
export function ActivityFilters({ filters, subjects, onChange }: Props) {
  const view = currentView(filters);
  const { setContainer, setItem, box, ready } = useSlidingIndicator(
    VIEWS.findIndex((v) => v.value === view),
  );
  const wide = useMediaQuery('(min-width: 640px)');
  const extra = [filters.subject, filters.priority, filters.type, filters.radar].filter(
    Boolean,
  ).length;

  const setView = (next: View) => {
    const rest: Filters = { ...filters, status: undefined, overdue: undefined };
    if (next === 'all') onChange(rest);
    else if (next === 'overdue') onChange({ ...rest, overdue: true });
    else onChange({ ...rest, status: next });
  };

  return (
    <section aria-label="Filtros" className="flex flex-col gap-3">
      {/* A segmented control: one soft track and a white highlight that SLIDES to the chosen state (it follows the
          button onto a second row when the track wraps). Still plain buttons with aria-pressed: the highlight is
          decoration. */}
      <div
        role="group"
        aria-label="Estado"
        ref={setContainer}
        className="relative flex flex-wrap gap-1 rounded-3xl bg-secondary p-1"
      >
        {box && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-0 left-0 rounded-full bg-surface shadow-card ${
              ready
                ? 'transition-[transform,width,height] duration-(--duration-normal) ease-enter'
                : ''
            }`}
            style={{
              transform: `translate(${box.x}px, ${box.y}px)`,
              width: box.width,
              height: box.height,
            }}
          />
        )}
        {VIEWS.map((v, i) => (
          <button
            key={v.value}
            ref={setItem}
            data-index={i}
            type="button"
            aria-pressed={view === v.value}
            onClick={() => setView(v.value)}
            className={`relative z-10 min-h-11 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-(--duration-fast) ease-standard active:scale-[0.97] ${
              view === v.value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {wide ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SelectField
            className="col-span-2 sm:col-span-1"
            id="filter-subject"
            label="Asignatura"
            placeholder="Todas"
            value={filters.subject ?? ''}
            onChange={(v) => onChange({ ...filters, subject: v || undefined })}
            options={subjects.map((s) => ({ value: s.id, label: s.name }))}
          />
          <SelectField
            id="filter-priority"
            label="Prioridad"
            placeholder="Todas"
            value={filters.priority ?? ''}
            onChange={(v) =>
              onChange({ ...filters, priority: (v || undefined) as Filters['priority'] })
            }
            options={ACTIVITY_PRIORITIES.map((p) => ({
              value: p,
              label: ACTIVITY_PRIORITY_LABELS[p],
            }))}
          />
          <SelectField
            id="filter-type"
            label="Tipo"
            placeholder="Todos"
            value={filters.type ?? ''}
            onChange={(v) => onChange({ ...filters, type: (v || undefined) as Filters['type'] })}
            options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
          />
          <SelectField
            className="col-span-2 sm:col-span-1"
            id="filter-radar"
            label="Radar"
            placeholder="Todas"
            value={filters.radar ?? ''}
            onChange={(v) => onChange({ ...filters, radar: (v || undefined) as Filters['radar'] })}
            options={RADAR_STATUSES.map((s) => ({ value: s, label: RADAR_GROUP_LABELS[s] }))}
          />
        </div>
      ) : (
        <details open={extra > 0} className="rounded-md border border-slate-300 p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
            Más filtros{extra > 0 && ` (${extra} activos)`}
          </summary>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SelectField
              className="col-span-2 sm:col-span-1"
              id="filter-subject"
              label="Asignatura"
              placeholder="Todas"
              value={filters.subject ?? ''}
              onChange={(v) => onChange({ ...filters, subject: v || undefined })}
              options={subjects.map((s) => ({ value: s.id, label: s.name }))}
            />
            <SelectField
              id="filter-priority"
              label="Prioridad"
              placeholder="Todas"
              value={filters.priority ?? ''}
              onChange={(v) =>
                onChange({ ...filters, priority: (v || undefined) as Filters['priority'] })
              }
              options={ACTIVITY_PRIORITIES.map((p) => ({
                value: p,
                label: ACTIVITY_PRIORITY_LABELS[p],
              }))}
            />
            <SelectField
              id="filter-type"
              label="Tipo"
              placeholder="Todos"
              value={filters.type ?? ''}
              onChange={(v) => onChange({ ...filters, type: (v || undefined) as Filters['type'] })}
              options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
            />
            <SelectField
              className="col-span-2 sm:col-span-1"
              id="filter-radar"
              label="Radar"
              placeholder="Todas"
              value={filters.radar ?? ''}
              onChange={(v) =>
                onChange({ ...filters, radar: (v || undefined) as Filters['radar'] })
              }
              options={RADAR_STATUSES.map((s) => ({ value: s, label: RADAR_GROUP_LABELS[s] }))}
            />
          </div>
        </details>
      )}

      {hasActiveFilters(filters) && (
        <div>
          <button
            type="button"
            onClick={() => onChange({})}
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </section>
  );
}
