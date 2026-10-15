import { QueryError } from '../components/QueryError';
import { formatDateOnly, type AcademicPeriod, type Subject } from '@planner/core';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { homeGate } from '../academic/homeGate';
import { useHomePeriod, usePeriods, useSubjects } from '../academic/useAcademic';
import { useStudyTracks } from '../studyTracks/useStudyTracks';
import { buttonStyles } from '../components/ui/buttonStyles';
import { DeleteSubjectDialog } from './subjects/DeleteSubjectDialog';
import { SubjectCard } from './subjects/SubjectCard';
import { SubjectFormDialog } from './subjects/SubjectFormDialog';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';

/**
 * The subjects of ONE period, in two modes that never mix:
 *  - `/subjects`: the HOME period, as always. This route is NOT behind `RequirePeriod` any more, so the page asks for HOME itself
 *    (the same `homeGate`) and sends the user to the onboarding when there is none, exactly as the gate did;
 *  - `/subjects?period=<id>`: THAT period, if it is the user's own (the "Ver materias" link of "Mis estudios"). It does not need
 *    HOME at all: a study whose current period exists can be opened when the main study has none. A period that is not the
 *    user's looks exactly like one that does not exist, and it does not send anyone to the onboarding.
 * A subject created here goes to the period shown: an explicit destination, never a guess.
 */
export function SubjectsPage() {
  const [params] = useSearchParams();
  const requested = params.get('period');
  return requested ? <ExplicitPeriodSubjects id={requested} /> : <HomePeriodSubjects />;
}

function HomePeriodSubjects() {
  const home = useHomePeriod();
  switch (homeGate(home)) {
    case 'LOADING':
      return <p role="status">Cargando tu periodo académico…</p>;
    case 'ERROR':
      return <QueryError query={home} title="No se pudo cargar tu periodo académico" />;
    case 'ONBOARD':
      return <Navigate to="/onboarding" replace />;
    case 'ENTER':
      return <SubjectsView period={home.data!} explicit={false} />;
  }
}

function ExplicitPeriodSubjects({ id }: { id: string }) {
  const periods = usePeriods();
  const period = periods.data?.find((p) => p.id === id);
  if (periods.isPending) return <p role="status">Cargando…</p>;
  if (periods.isError && !periods.data) {
    return <QueryError query={periods} title="No se pudieron cargar tus periodos" />;
  }
  if (!period) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Mis asignaturas" />
        <EmptyState title="No encontramos ese periodo.">
          Puede que ya no exista. Tus asignaturas están en tus estudios.
        </EmptyState>
        <div>
          <Link to="/settings/studies" className={buttonStyles({ variant: 'primary' })}>
            Ir a Mis estudios
          </Link>
        </div>
      </div>
    );
  }
  return <SubjectsView period={period} explicit />;
}

function SubjectsView({ period, explicit }: { period: AcademicPeriod; explicit: boolean }) {
  const [params, setParams] = useSearchParams();
  const tracks = useStudyTracks();
  const subjects = useSubjects(period.id);
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

  // With several studies the title says WHICH one ("Medicina · 2026-2"); a plan without a study keeps just the period's name.
  const study = tracks.data?.find((t) => t.id === period.studyTrackId);
  const studyPrefix = study && (tracks.data?.length ?? 0) >= 2 ? `${study.name} · ` : '';

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
        description={`${studyPrefix}${period.name} · ${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}`}
        actions={list.length > 0 && add}
      />

      {explicit && (
        <p>
          <Link to="/settings/studies" className="text-sm font-medium text-accent-ink underline">
            ← Volver a Mis estudios
          </Link>
        </p>
      )}

      {notice && (
        <p role="status" className="rounded-control bg-success-soft p-3 text-sm text-success-ink">
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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              onEdit={() => setEditing(subject)}
              onDelete={() => setDeleting(subject)}
            />
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
