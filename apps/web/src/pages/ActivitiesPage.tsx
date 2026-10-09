import { QueryError } from '../components/QueryError';
import { DEFAULT_TIMEZONE, type Activity, type ActivityStatus } from '@planner/core';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useUpdateActivity, useActivities } from '../activities/useActivities';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { useMe } from '../auth/useAuth';
import { useNow } from '../lib/useNow';
import { Button } from '../components/ui/Button';
import { buttonStyles } from '../components/ui/buttonStyles';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { ActivityFilters } from './activities/ActivityFilters';
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
  const timeZone = useMe().data?.timezone ?? DEFAULT_TIMEZONE;
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
  const canCreate = subjectList.length > 0;

  const add = canCreate ? (
    <Button variant="primary" onClick={() => setEditing('new')}>
      Agregar actividad
    </Button>
  ) : null;

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

      <QueryError query={subjects} title="No se pudieron cargar tus asignaturas" />

      {subjects.isSuccess && !canCreate && (
        <EmptyState
          title="Primero agrega una asignatura."
          action={
            <Link to="/subjects" className={buttonStyles({ variant: 'primary' })}>
              Ir a Asignaturas
            </Link>
          }
        >
          Cada actividad pertenece a una asignatura de este semestre.
        </EmptyState>
      )}

      {canCreate && (
        <>
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
        </>
      )}

      {current && canCreate && (
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
