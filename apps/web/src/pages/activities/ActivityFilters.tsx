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
import { useEffect, useState } from 'react';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ChevronDownIcon, SlidersIcon } from '../../components/ui/icons';
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

/**
 * The filters of Activities. One row of states as a segmented control (the final design of UX1-2.5): a soft track and a
 * white highlight that SLIDES to the chosen state. On a phone the row scrolls sideways instead of wrapping onto a second
 * line (the chosen state is always brought into view); from 640 px it fits and hugs its content. The other filters
 * (subject, priority, type, Radar) are native `<select>`s (the best control on every phone, and the accessible one),
 * gathered in one soft panel: always shown on a wide screen, behind a "Más filtros" disclosure on a phone.
 */
export function ActivityFilters({ filters, subjects, onChange }: Props) {
  const view = currentView(filters);
  const { setContainer, container, setItem, box, ready } = useSlidingIndicator(
    VIEWS.findIndex((v) => v.value === view),
  );
  const wide = useMediaQuery('(min-width: 640px)');
  const extra = [filters.subject, filters.priority, filters.type, filters.radar].filter(
    Boolean,
  ).length;
  // Open from the start when a link or a reload arrives with some of them applied (as before); the student can fold it.
  const [openPanel, setOpenPanel] = useState(extra > 0);

  // Bring the chosen state into view when the row scrolls sideways (a phone). It scrolls the ROW only (never the page).
  // `scrollIntoView` is avoided on purpose: it moves the browser's starting point for Tab, so the first Tab stop of the
  // page would no longer be the "Saltar al contenido" link.
  useEffect(() => {
    const chosen = container?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!container || !chosen) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = chosen.offsetLeft - (container.clientWidth - chosen.offsetWidth) / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: calm ? 'auto' : 'smooth' });
  }, [view, container]);

  const setView = (next: View) => {
    const rest: Filters = { ...filters, status: undefined, overdue: undefined };
    if (next === 'all') onChange(rest);
    else if (next === 'overdue') onChange({ ...rest, overdue: true });
    else onChange({ ...rest, status: next });
  };

  const selects = (
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
        options={ACTIVITY_PRIORITIES.map((p) => ({ value: p, label: ACTIVITY_PRIORITY_LABELS[p] }))}
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
  );

  return (
    <section aria-label="Filtros" className="flex flex-col gap-3">
      {/* A segmented control: one soft track and a white highlight that SLIDES to the chosen state. Still plain buttons
          with aria-pressed: the highlight is decoration. */}
      <div
        role="group"
        aria-label="Estado"
        ref={setContainer}
        className="relative flex w-full max-w-full snap-x overflow-x-auto rounded-full bg-secondary p-1 [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden"
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
            className={`relative z-10 min-h-11 shrink-0 snap-center rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard active:scale-[0.97] ${
              view === v.value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {wide ? (
        <Card variant="soft" className="p-3">
          {selects}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={openPanel}
            aria-controls="filtros-avanzados"
            onClick={() => setOpenPanel((o) => !o)}
            className="flex min-h-11 w-full items-center gap-2 rounded-full border border-border bg-surface/80 px-4 text-sm font-medium transition-colors duration-(--duration-fast) ease-standard hover:bg-secondary active:scale-[0.99]"
          >
            <SlidersIcon className="size-4 text-accent-ink" />
            <span>Más filtros</span>
            {extra > 0 && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-ink">
                {extra} {extra === 1 ? 'activo' : 'activos'}
              </span>
            )}
            <ChevronDownIcon
              className={`ml-auto size-4 text-muted-foreground transition-transform duration-(--duration-normal) ease-standard ${
                openPanel ? 'rotate-180' : ''
              }`}
            />
          </button>
          {openPanel && (
            <Card variant="soft" as="div" id="filtros-avanzados" className="animate-rise p-3">
              {selects}
            </Card>
          )}
        </div>
      )}

      {hasActiveFilters(filters) && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onChange({})} className="underline">
            Limpiar filtros
          </Button>
        </div>
      )}
    </section>
  );
}
