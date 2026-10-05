import { QueryError } from '../components/QueryError';
import { formatDateOnly, type Subject } from '@planner/core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { DeleteSubjectDialog } from './subjects/DeleteSubjectDialog';
import { SubjectFormDialog } from './subjects/SubjectFormDialog';

const primaryButton =
  'min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const secondaryButton =
  'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100';

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
    <button type="button" onClick={() => setEditing('new')} className={primaryButton}>
      Agregar asignatura
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Mis asignaturas</h1>
          <p className="text-sm text-slate-600 break-words">
            {period.name} · {formatDateOnly(period.startDate)} – {formatDateOnly(period.endDate)}
          </p>
        </div>
        {list.length > 0 && add}
      </header>

      {notice && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}

      {subjects.isPending && <p role="status">Cargando asignaturas…</p>}

      <QueryError query={subjects} title="No se pudieron cargar tus asignaturas" />

      {subjects.isSuccess && list.length === 0 && (
        <section className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="mb-1 text-lg font-medium">Aún no tienes asignaturas.</p>
          <p className="mb-4 text-slate-600">
            Agrega las materias de este semestre para comenzar a organizar tus actividades.
          </p>
          {add}
        </section>
      )}

      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((subject) => (
            <li
              key={subject.id}
              className="flex min-w-0 overflow-hidden rounded-lg border border-slate-300"
            >
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
                  <button
                    type="button"
                    aria-label={`Editar ${subject.name}`}
                    onClick={() => setEditing(subject)}
                    className={secondaryButton}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${subject.name}`}
                    onClick={() => setDeleting(subject)}
                    className={`${secondaryButton} text-red-800`}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
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
