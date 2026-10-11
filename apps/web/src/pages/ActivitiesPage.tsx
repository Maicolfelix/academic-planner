import { QueryError } from '../components/QueryError';
import { DEFAULT_TIMEZONE, type Activity, type ActivityStatus } from '@planner/core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useUpdateActivity, useActivities } from '../activities/useActivities';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { useMe } from '../auth/useAuth';
import { clearDraft, useStoredDraft } from '../lib/drafts';
import { useNow } from '../lib/useNow';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { ActivityFilters } from './activities/ActivityFilters';
import { activityDraftSchema, activityDraftScope, isBlank } from './activities/activityDraft';
import { ActivityFormDialog } from './activities/ActivityFormDialog';
import { ActivityList } from './activities/ActivityList';
import { DeleteActivityDialog } from './activities/DeleteActivityDialog';
import {
  hasActiveFilters,
  parseFilters,
  serializeFilters,
  toApiQuery,
  type ActivityFilters as Filters,
} from './activities/filterParams';

/** Activities of the current period: filter (kept in the URL), create, edit, change status, delete. */
export function ActivitiesPage() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const setFilters = (next: Filters) => setParams(serializeFilters(next), { replace: true });

  const { period } = useCurrentPeriod();
  const subjects = useSubjects(period?.id);
  const activities = useActivities(toApiQuery(filters, period?.id), period !== undefined);
  const me = useMe().data;
  const timeZone = me?.timezone ?? DEFAULT_TIMEZONE;
  // An activity the student began and did not finish (kept as a draft): offered back, never forced.
  const createScope = activityDraftScope(undefined, period?.id);
  const unfinished = useStoredDraft(me?.id, createScope, activityDraftSchema)?.payload;
  const now = useNow();
  const updateStatus = useUpdateActivity();

  const [editing, setEditing] = useState<Activity | 'new' | null>(() =>
    params.get('action') === 'create' ? 'new' : null,
  );
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [notice, setNotice] = useState<string>();
  const [statusError, setStatusError] = useState<string>();

  // Arrived through a quick action (?action=create): the dialog is already opening (initial state),
  // so drop that one-shot parameter from the URL.
  useEffect(() => {
    if (!params.has('action')) return;
    const rest = new URLSearchParams(params);
    rest.delete('action');
    setParams(rest, { replace: true });
  }, [params, setParams]);

  // Arrived through a "Ver actividad" link (?edit=<id>): the dialog is derived from the URL once the FRESH list
  // is loaded (no extra state). An id that is not in the list is simply dropped from the URL.
  const editId = params.get('edit');
  const listReady = activities.isSuccess && !activities.isFetching;
  const linked = editId && listReady ? activities.data.find((a) => a.id === editId) : undefined;
  useEffect(() => {
    if (!editId || !listReady || linked) return;
    const rest = new URLSearchParams(params);
    rest.delete('edit');
    setParams(rest, { replace: true });
  }, [editId, listReady, linked, params, setParams]);
  const current = editing ?? linked ?? null;
  const closeEditor = () => {
    setEditing(null);
    if (!params.has('edit')) return;
    const rest = new URLSearchParams(params);
    rest.delete('edit');
    setParams(rest, { replace: true });
  };
  if (!period) return null; // RequirePeriod guarantees one; keeps the type honest

  const subjectList = subjects.data ?? [];
  const list = activities.data ?? [];
  const filtered = hasActiveFilters(filters);

  // A subject is optional (F1): having none no longer blocks adding an activity.
  const add = (
    <Button variant="primary" onClick={() => setEditing('new')}>
      Agregar actividad
    </Button>
  );

  function changeStatus(activity: Activity, status: ActivityStatus) {
    setStatusError(undefined);
    updateStatus.mutate(
      { id: activity.id, input: { status } },
      { onError: (err) => setStatusError(err.message) },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Actividades" description={period.name} actions={list.length > 0 && add} />

      {notice && (
        <p role="status" className="rounded-control bg-success-soft p-3 text-sm text-success-ink">
          {notice}
        </p>
      )}
      {statusError && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger-ink">
          No se pudo cambiar el estado: {statusError}
        </p>
      )}

      {unfinished && !isBlank(unfinished) && current === null && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-3 rounded-control border border-border bg-surface p-3 text-sm"
        >
          <span className="min-w-0 break-words">
            Tienes una actividad sin terminar
            {unfinished.title.trim() ? `: «${unfinished.title.trim()}»` : ''}.
          </span>
          <span className="flex flex-wrap gap-x-1">
            <Button
              size="sm"
              variant="ghost"
              className="text-accent-ink"
              onClick={() => setEditing('new')}
            >
              Retomar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => me && clearDraft(me.id, createScope)}>
              Descartar borrador
            </Button>
          </span>
        </p>
      )}

      <QueryError query={subjects} title="No se pudieron cargar tus asignaturas" />

      <ActivityFilters filters={filters} subjects={subjectList} onChange={setFilters} />

      {activities.isPending && <p role="status">Cargando actividades…</p>}

      <QueryError query={activities} title="No se pudieron cargar tus actividades" />

      {activities.isSuccess && list.length === 0 && !filtered && (
        <EmptyState title="Aún no tienes actividades." action={add}>
          Agrega tareas, parciales y entregas para tener todo en un solo lugar.
        </EmptyState>
      )}

      {activities.isSuccess && list.length === 0 && filtered && (
        <EmptyState
          title="No hay actividades que coincidan con los filtros."
          action={
            <Button size="sm" onClick={() => setFilters({})}>
              Limpiar filtros
            </Button>
          }
        />
      )}

      {list.length > 0 && (
        <ActivityList
          activities={list}
          subjects={subjectList}
          timeZone={timeZone}
          now={now}
          pendingStatusId={updateStatus.isPending ? updateStatus.variables?.id : undefined}
          onStatusChange={changeStatus}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}

      {/* Wait for the subjects: the form decides its first mode (a subject to choose, or none) from them, once. */}
      {current && subjects.isSuccess && (
        <ActivityFormDialog
          subjects={subjectList}
          activity={current === 'new' ? undefined : current}
          defaultSubjectId={filters.subject}
          timeZone={timeZone}
          onClose={closeEditor}
          onSaved={(message) => {
            closeEditor();
            setNotice(message);
          }}
        />
      )}
      {deleting && (
        <DeleteActivityDialog
          activity={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(message) => {
            setDeleting(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}
