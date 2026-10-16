import {
  GRADING_PERIOD_TERMS,
  defaultCutName,
  formatPercent,
  formatScore,
  formatUnitsPercent,
  type EducationContext,
  type Evaluation,
  type GradingPeriod,
  type Subject,
  type SubjectGradesResponse,
} from '@planner/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useActivities } from '../activities/useActivities';
import { ApiRequestError } from '../api/client';
import { QueryError } from '../components/QueryError';
import { ActionMenu } from '../components/ui/ActionMenu';
import { Button } from '../components/ui/Button';
import { buttonStyles } from '../components/ui/buttonStyles';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { AlertIcon, CheckIcon, PencilIcon, SlidersIcon, TrashIcon } from '../components/ui/icons';
import {
  ESTIMATE_TEXT,
  accumulatedText,
  currentText,
  cutSubtotal,
  groupByCut,
  rawText,
  requiredView,
  scoreText,
  statusText,
  type CutGroup,
} from '../grading/gradesModel';
import { useSubject, useSubjectGrades } from '../grading/useGrading';
import { ConfirmRemoveDialog, CutDialog, ScaleEditDialog } from './grades/ConfigDialogs';
import { EvaluationDialog, QuickGradeDialog } from './grades/EvaluationDialogs';
import { SetupDialog } from './grades/SetupDialog';

type Dialog =
  | { kind: 'setup' }
  | { kind: 'scale' }
  | { kind: 'cut'; cut?: GradingPeriod }
  | { kind: 'evaluation'; evaluation?: Evaluation; cutId: string }
  | { kind: 'quick'; evaluation: Evaluation }
  | { kind: 'remove-evaluation'; evaluation: Evaluation }
  | { kind: 'remove-cut'; cut: GradingPeriod };

export const isNotFound = (err: unknown) => err instanceof ApiRequestError && err.status === 404;

/**
 * The grades of ONE subject. The scale and the cuts belong to the PERIOD (so they are shared with the other subjects of it); the
 * evaluations belong to the subject. Everything comes from `GET /api/subjects/:id/grades` (the exact figures are the server's),
 * and ownership is the API's: a subject that is not yours looks exactly like one that does not exist.
 */
export function SubjectGradesPage() {
  const { subjectId = '' } = useParams();
  const subject = useSubject(subjectId);
  const grades = useSubjectGrades(subjectId);

  if (subject.isPending || grades.isPending) return <p role="status">Cargando las notas…</p>;
  if (isNotFound(subject.error) || isNotFound(grades.error)) return <GradesNotFound />;
  if (!subject.data || !grades.data) {
    return (
      <div className="flex flex-col gap-3">
        <QueryError query={subject} title="No se pudo cargar la asignatura" />
        <QueryError query={grades} title="No se pudieron cargar las notas" />
      </div>
    );
  }
  return <GradesView subject={subject.data} grades={grades.data} refetch={grades} />;
}

type StudyContext = NonNullable<SubjectGradesResponse['studyTrack']>;

/**
 * The period and its study come WITH the grades (derived by the server), so the screen never waits for, nor guesses, a study type:
 *  - a period that belongs to no study cannot be graded (and no type is invented for it);
 *  - a period that names a study whose context did not arrive is an inconsistent answer: it is retried, never read as a default.
 */
function GradesView({
  subject,
  grades,
  refetch,
}: {
  subject: Subject;
  grades: SubjectGradesResponse;
  refetch: Parameters<typeof QueryError>[0]['query'];
}) {
  const { period, studyTrack } = grades;
  if (period.studyTrackId !== null && !studyTrack) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={`Notas de ${subject.name}`} />
        <div role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
          <p className="mb-2">No pudimos cargar el estudio de este periodo.</p>
          <Button onClick={() => refetch.refetch()}>Reintentar</Button>
        </div>
      </div>
    );
  }
  if (!studyTrack) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={`Notas de ${subject.name}`} description={period.name} />
        <p>
          <Link to="/subjects" className="text-sm font-medium text-accent-ink underline">
            ← Volver a Mis asignaturas
          </Link>
        </p>
        <EmptyState
          title="Las notas necesitan un estudio"
          titleAs="h2"
          action={
            <Link to="/settings/studies" className={buttonStyles({ variant: 'primary' })}>
              Ir a Mis estudios
            </Link>
          }
        >
          Este periodo no pertenece a ningún estudio. Conviértelo en un estudio para llevar tus
          notas.
        </EmptyState>
      </div>
    );
  }
  return (
    <TrackedGradesView subject={subject} grades={grades} track={studyTrack} refetch={refetch} />
  );
}

/** The friendly answer for a subject that does not exist or is not yours (the API answers both with the same 404). */
export function GradesNotFound() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Notas" />
      <EmptyState title="No encontramos esa asignatura.">
        Puede que ya no exista. Tus asignaturas están en Mis asignaturas.
      </EmptyState>
      <div>
        <Link to="/subjects" className={buttonStyles({ variant: 'primary' })}>
          Ir a Mis asignaturas
        </Link>
      </div>
    </div>
  );
}

function TrackedGradesView({
  subject,
  grades,
  track,
  refetch,
}: {
  subject: Subject;
  grades: SubjectGradesResponse;
  track: StudyContext;
  refetch: Parameters<typeof QueryError>[0]['query'];
}) {
  const activities = useActivities({ subjectId: subject.id }, true);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string>();

  const { period } = grades;
  const studyType: EducationContext = track.type; // only ever the real study's type
  const terms = GRADING_PERIOD_TERMS[studyType];
  const { profile, summary } = grades;
  const groups = groupByCut(grades.gradingPeriods, grades.evaluations);
  const activityTitle = (id: string | null) =>
    id ? activities.data?.find((a) => a.id === id)?.title : undefined;

  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
  };
  const close = () => setDialog(null);

  const description = [
    track.name,
    period.name,
    track.status === 'ARCHIVED' ? 'Estudio archivado' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Notas de ${subject.name}`}
        description={description}
        actions={
          profile && (
            <ActionMenu
              label="Configurar notas"
              items={[
                {
                  label: 'Escala de notas',
                  icon: <SlidersIcon />,
                  onSelect: () => setDialog({ kind: 'scale' }),
                },
                {
                  label: `Agregar ${terms.one.toLowerCase()}`,
                  onSelect: () => setDialog({ kind: 'cut' }),
                },
              ]}
            />
          )
        }
      />

      <p>
        <Link to="/subjects" className="text-sm font-medium text-accent-ink underline">
          ← Volver a Mis asignaturas
        </Link>
      </p>

      {track.status === 'ARCHIVED' && (
        <p className="rounded-control bg-secondary p-3 text-sm">
          Este estudio está archivado. Tus notas se conservan y puedes consultarlas.
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-control bg-success-soft p-3 text-sm text-success-ink">
          {notice}
        </p>
      )}
      <QueryError query={refetch} title="No se pudieron actualizar las notas" />

      {!profile && (
        <EmptyState
          title="Configura cómo califican esta materia"
          titleAs="h2"
          action={
            <Button variant="primary" onClick={() => setDialog({ kind: 'setup' })}>
              Configurar notas
            </Button>
          }
        >
          La escala y {terms.theMany} se comparten con las demás materias de este periodo.
        </EmptyState>
      )}

      {profile && summary && (
        <Card
          as="section"
          variant="tinted"
          aria-labelledby="grade-summary"
          className="flex flex-col gap-3 p-4"
        >
          <h2 id="grade-summary" className="text-section-title">
            Resumen de notas
          </h2>
          <div>
            <p className="text-sm font-medium">Nota acumulada</p>
            <p className="text-3xl font-semibold break-words" data-testid="accumulated-grade">
              {accumulatedText(grades.gradingPeriods, grades.evaluations, profile.decimals)}
            </p>
            <p className="text-sm text-muted-foreground">
              Lo que llevas en la materia: suma lo que cada evaluación ya aporta a la nota final (lo
              pendiente cuenta 0 por ahora). Aprobatoria:{' '}
              {formatScore(profile.passMilli, profile.decimals)}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Promedio de lo evaluado</p>
            <p className="text-xl font-semibold break-words" data-testid="current-grade">
              {currentText(summary, profile.decimals)}
            </p>
            <p className="text-sm text-muted-foreground">
              Solo de las evaluaciones con nota, sin contar lo pendiente.
            </p>
          </div>
          {statusText(summary) && (
            <p className="flex items-start gap-2">
              {summary.currentPasses ? (
                <CheckIcon className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{statusText(summary)}</span>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Calificado: {formatUnitsPercent(summary.evaluatedWeightUnits)} de la nota final ·
            Pendiente: {formatUnitsPercent(summary.remainingWeightUnits)}
          </p>
          <RequiredBlock summary={summary} decimals={profile.decimals} />
        </Card>
      )}

      {profile &&
        groups.map((group) => (
          <CutSection
            key={group.cut.id}
            group={group}
            decimals={profile.decimals}
            termOne={terms.one}
            activityTitle={activityTitle}
            onAdd={() => setDialog({ kind: 'evaluation', cutId: group.cut.id })}
            onEditCut={() => setDialog({ kind: 'cut', cut: group.cut })}
            onRemoveCut={() => setDialog({ kind: 'remove-cut', cut: group.cut })}
            onQuick={(evaluation) => setDialog({ kind: 'quick', evaluation })}
            onEdit={(evaluation) =>
              setDialog({ kind: 'evaluation', evaluation, cutId: evaluation.gradingPeriodId })
            }
            onRemove={(evaluation) => setDialog({ kind: 'remove-evaluation', evaluation })}
          />
        ))}

      {profile && grades.gradingPeriods.length === 0 && (
        <EmptyState
          title={`Aún no hay ${terms.many.toLowerCase()}`}
          titleAs="h2"
          action={
            <Button variant="primary" onClick={() => setDialog({ kind: 'cut' })}>
              Agregar {terms.one.toLowerCase()}
            </Button>
          }
        >
          Agrega al menos uno para registrar evaluaciones.
        </EmptyState>
      )}

      {dialog?.kind === 'setup' && (
        <SetupDialog
          periodId={period.id}
          studyType={studyType}
          onClose={close}
          onDone={() => done('Notas configuradas.')}
        />
      )}
      {dialog?.kind === 'scale' && profile && (
        <ScaleEditDialog
          periodId={profile.periodId}
          profile={profile}
          onClose={close}
          onDone={() => done('Escala actualizada.')}
        />
      )}
      {dialog?.kind === 'cut' && profile && (
        <CutDialog
          periodId={profile.periodId}
          studyType={studyType}
          cut={dialog.cut}
          defaultName={defaultCutName(studyType, grades.gradingPeriods.length + 1)}
          onClose={close}
          onDone={() => done('Cambios guardados.')}
        />
      )}
      {dialog?.kind === 'evaluation' && profile && (
        <EvaluationDialog
          subjectId={subject.id}
          profile={profile}
          cuts={grades.gradingPeriods}
          studyType={studyType}
          evaluation={dialog.evaluation}
          initialCutId={dialog.cutId}
          onClose={close}
          onDone={() =>
            done(dialog.evaluation ? 'Evaluación actualizada.' : 'Evaluación agregada.')
          }
        />
      )}
      {dialog?.kind === 'quick' && profile && (
        <QuickGradeDialog
          subjectId={subject.id}
          profile={profile}
          evaluation={dialog.evaluation}
          onClose={close}
          onDone={() => done('Nota guardada.')}
        />
      )}
      {dialog?.kind === 'remove-evaluation' && (
        <ConfirmRemoveDialog
          kind="evaluation"
          id={dialog.evaluation.id}
          name={dialog.evaluation.name}
          periodId={period.id}
          subjectId={subject.id}
          onClose={close}
          onDone={() => done('Evaluación eliminada.')}
        />
      )}
      {dialog?.kind === 'remove-cut' && (
        <ConfirmRemoveDialog
          kind="cut"
          id={dialog.cut.id}
          name={dialog.cut.name}
          periodId={period.id}
          subjectId={subject.id}
          onClose={close}
          onDone={() => done('Eliminado.')}
        />
      )}
    </div>
  );
}

function RequiredBlock({
  summary,
  decimals,
}: {
  summary: NonNullable<SubjectGradesResponse['summary']>;
  decimals: number;
}) {
  const view = requiredView(summary, decimals);
  return (
    <section
      aria-labelledby="grade-required"
      className="rounded-control border border-border bg-surface p-3"
    >
      <h3 id="grade-required" className="text-card-title">
        ¿Cuánto necesito?
      </h3>
      <p className="mt-1" data-testid="required-text">
        {view.text}
      </p>
      {view.estimate && (
        <p
          className="mt-1 flex items-start gap-2 text-sm text-warning-ink"
          data-testid="estimate-note"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{ESTIMATE_TEXT}</span>
        </p>
      )}
    </section>
  );
}

function CutSection({
  group,
  decimals,
  termOne,
  activityTitle,
  onAdd,
  onEditCut,
  onRemoveCut,
  onQuick,
  onEdit,
  onRemove,
}: {
  group: CutGroup;
  decimals: number;
  termOne: string;
  activityTitle: (id: string | null) => string | undefined;
  onAdd: () => void;
  onEditCut: () => void;
  onRemoveCut: () => void;
  onQuick: (e: Evaluation) => void;
  onEdit: (e: Evaluation) => void;
  onRemove: (e: Evaluation) => void;
}) {
  const { cut, evaluations } = group;
  const subtotal = cutSubtotal(group, decimals);
  const headingId = `cut-${cut.id}`;
  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-section-title break-words">
            {cut.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatPercent(cut.finalShareBp)} de la nota final
            {subtotal !== null && ` · Subtotal: ${subtotal}`}
          </p>
        </div>
        <ActionMenu
          label={`Más acciones: ${cut.name}`}
          items={[
            { label: `Editar ${termOne.toLowerCase()}`, icon: <PencilIcon />, onSelect: onEditCut },
            {
              label: `Eliminar ${termOne.toLowerCase()}`,
              ariaLabel: `Eliminar ${cut.name}`,
              icon: <TrashIcon />,
              danger: true,
              onSelect: onRemoveCut,
            },
          ]}
        />
      </header>

      {evaluations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay evaluaciones aquí.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {evaluations.map((e) => (
            <EvaluationRow
              key={e.id}
              evaluation={e}
              decimals={decimals}
              activity={activityTitle(e.activityId)}
              onQuick={() => onQuick(e)}
              onEdit={() => onEdit(e)}
              onRemove={() => onRemove(e)}
            />
          ))}
        </ul>
      )}

      <div>
        <Button size="sm" onClick={onAdd} aria-label={`Agregar evaluación a ${cut.name}`}>
          Agregar evaluación
        </Button>
      </div>
    </Card>
  );
}

function EvaluationRow({
  evaluation: e,
  decimals,
  activity,
  onQuick,
  onEdit,
  onRemove,
}: {
  evaluation: Evaluation;
  decimals: number;
  activity: string | undefined;
  onQuick: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const score = scoreText(e, decimals);
  const raw = rawText(e);
  return (
    <li className="flex items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium break-words">{e.name}</p>
        <p className="text-sm text-muted-foreground">
          Peso: {formatPercent(e.periodShareBp)} del corte
          {raw && ` · ${raw}`}
        </p>
        {activity && (
          <p className="text-sm text-muted-foreground break-words">Actividad: {activity}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {score !== null ? (
          <span className="px-2 font-semibold" aria-label={`Nota: ${score}`}>
            {score}
          </span>
        ) : (
          <Button size="sm" onClick={onQuick} aria-label={`Registrar nota de ${e.name}`}>
            Pendiente
          </Button>
        )}
        <ActionMenu
          label={`Más acciones: ${e.name}`}
          items={[
            {
              label: 'Editar',
              ariaLabel: `Editar ${e.name}`,
              icon: <PencilIcon />,
              onSelect: onEdit,
            },
            {
              label: 'Eliminar',
              ariaLabel: `Eliminar ${e.name}`,
              icon: <TrashIcon />,
              danger: true,
              onSelect: onRemove,
            },
          ]}
        />
      </div>
    </li>
  );
}
