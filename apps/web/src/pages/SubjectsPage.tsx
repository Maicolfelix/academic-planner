import { QueryError } from '../components/QueryError';
import { formatDateOnly, type Subject } from '@planner/core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { DeleteSubjectDialog } from './subjects/DeleteSubjectDialog';
import { SubjectFormDialog } from './subjects/SubjectFormDialog';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';

/** The current period's subjects: list, create, edit, delete. */
export function SubjectsPage() {
  const { period } = useCurrentPeriod();
  const subjects = useSubjects(period?.id);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Subject | 'new' | null>(() =>
    params.get('action') === 'create' ? 'new' : null,
  );
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const [notice, setNotice] = useState<string>();

  // Arrived through a quick action (?action=create): the dialog is already opening (initial state),
  // so drop that one-shot parameter from the URL.
  useEffect(() => {
    if (!params.has('action')) return;
    const rest = new URLSearchParams(params);
    rest.delete('action');
    setParams(rest, { replace: true });
  }, [params, setParams]);
  if (!period) return null; // RequirePeriod guarantees one; keeps the type honest

  const list = subjects.data ?? [];
  const add = (
    <Button variant="primary" onClick={() => setEditing('new')}>
      Agregar asignatura
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Mis asignaturas"
        description={`${period.name} · ${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}`}
        actions={list.length > 0 && add}
      />

      {notice && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}

      {subjects.isPending && <p role="status">Cargando asignaturas…</p>}

      <QueryError query={subjects} title="No se pudieron cargar tus asignaturas" />

      {subjects.isSuccess && list.length === 0 && (
        <EmptyState title="Aún no tienes asignaturas." action={add}>
          Agrega las materias de este semestre para comenzar a organizar tus actividades.
        </EmptyState>
      )}

      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((subject) => (
            <Card as="li" key={subject.id} className="flex min-w-0 overflow-hidden">
              <span
                aria-hidden="true"
                style={{ backgroundColor: subject.color }}
                className="w-2 shrink-0"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                <div className="min-w-0">
                  <h2 className="font-semibold break-words">{subject.name}</h2>
                  {subject.professor && (
                    <p className="text-sm text-slate-700 break-words">
                      Profesor: {subject.professor}
                    </p>
                  )}
                  {subject.description && (
                    <p className="mt-1 line-clamp-3 text-sm text-slate-600 break-words">
                      {subject.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    aria-label={`Editar ${subject.name}`}
                    onClick={() => setEditing(subject)}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    aria-label={`Eliminar ${subject.name}`}
                    onClick={() => setDeleting(subject)}
                    className="text-danger"
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}

      {editing && (
        <SubjectFormDialog
          periodId={period.id}
          subject={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
          }}
        />
      )}
      {deleting && (
        <DeleteSubjectDialog
          subject={deleting}
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
