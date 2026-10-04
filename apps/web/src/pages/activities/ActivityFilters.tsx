import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_PRIORITY_LABELS,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  type ActivityStatus,
  type Subject,
} from '@planner/core';
import { SelectField } from '../../components/SelectField';
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

  const setView = (next: View) => {
    const rest: Filters = { ...filters, status: undefined, overdue: undefined };
    if (next === 'all') onChange(rest);
    else if (next === 'overdue') onChange({ ...rest, overdue: true });
    else onChange({ ...rest, status: next });
  };

  return (
    <section aria-label="Filtros" className="flex flex-col gap-3">
      <div role="group" aria-label="Estado" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            aria-pressed={view === v.value}
            onClick={() => setView(v.value)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${
              view === v.value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-400 bg-white text-slate-800 hover:bg-slate-100'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
      </div>

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
