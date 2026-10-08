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
import { Card } from '../components/ui/Card';
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page-title">Actividades</h1>
          <p className="text-sm text-muted-foreground break-words">{period.name}</p>
        </div>
        {list.length > 0 && add}
      </header>

      {notice && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      {statusError && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          No se pudo cambiar el estado: {statusError}
        </p>
      )}

      <QueryError query={subjects} title="No se pudieron cargar tus asignaturas" />

      {subjects.isSuccess && !canCreate && (
        <Card as="section" variant="dashed" className="p-6 text-center">
          <p className="mb-1 text-lg font-medium">Primero agrega una asignatura.</p>
          <p className="mb-4 text-slate-600">
            Cada actividad pertenece a una asignatura de este semestre.
          </p>
          <Link to="/subjects" className={buttonStyles({ variant: 'primary' })}>
            Ir a Asignaturas
          </Link>
        </Card>
      )}

      {canCreate && (
        <>
          <ActivityFilters filters={filters} subjects={subjectList} onChange={setFilters} />

          {activities.isPending && <p role="status">Cargando actividades…</p>}

          <QueryError query={activities} title="No se pudieron cargar tus actividades" />

          {activities.isSuccess && list.length === 0 && !filtered && (
            <Card as="section" variant="dashed" className="p-6 text-center">
              <p className="mb-1 text-lg font-medium">Aún no tienes actividades.</p>
              <p className="mb-4 text-slate-600">
                Agrega tareas, parciales y entregas para tener todo en un solo lugar.
              </p>
              {add}
            </Card>
          )}

          {activities.isSuccess && list.length === 0 && filtered && (
            <Card as="section" variant="dashed" className="p-6 text-center">
              <p className="mb-3 text-lg font-medium">
                No hay actividades que coincidan con los filtros.
              </p>
              <Button size="sm" onClick={() => setFilters({})}>
                Limpiar filtros
              </Button>
            </Card>
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
