import { useState } from 'react';
import {
  useCurrentPeriods,
  useCurrentSubjects,
  useHomePeriod,
  usePeriods,
} from '../academic/useAcademic';
import { QueryError } from '../components/QueryError';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { useProfile } from '../profile/useProfile';
import {
  activeCards,
  archivedTracks,
  legacyPlan,
  periodsOf,
  suggestStudy,
  typeLabel,
  type Suggestion,
} from '../studies/studyModel';
import { useStudyTracks } from '../studyTracks/useStudyTracks';
import type { AcademicPeriod, StudyTrack } from '@planner/core';
import { AddStudyDialog } from './studies/AddStudyDialog';
import { AdoptDialog } from './studies/AdoptDialog';
import { EditStudyDialog } from './studies/EditStudyDialog';
import { LegacyPlanCard } from './studies/LegacyPlanCard';
import { PeriodsDialog } from './studies/PeriodsDialog';
import { StudyActionDialog, type StudyAction } from './studies/StudyActionDialog';
import { StudyCard } from './studies/StudyCard';

type Dialog =
  | { kind: 'add' }
  // The plan and its proposal are kept in the dialog's own state: once the study exists the plan is no longer "without a study",
  // and the dialog must outlive that change to say it worked (a mutation callback does not run after its component unmounts).
  | { kind: 'adopt'; period: AcademicPeriod; suggestion: Suggestion }
  | { kind: 'edit'; track: StudyTrack }
  | { kind: 'periods'; track: StudyTrack }
  | { kind: 'action'; action: StudyAction; track: StudyTrack };

/**
 * MIS ESTUDIOS. The studies the person takes (a degree, a school, a diploma, a language course): add one, edit it, choose the
 * main one, archive and restore, and look after its periods. It is a screen to MANAGE things, not a workspace: there is no
 * "current study" selector anywhere, the Home stays one and the Agenda stays global.
 *
 * Opening it only READS. The plan an older account already has (a period that belongs to no study) is offered as "Tu
 * planificación actual" with a proposal built from the profile; nothing is created from the profile, the period's name or
 * anything else until the student confirms a form.
 */
export function StudiesPage() {
  const tracks = useStudyTracks();
  const periods = usePeriods();
  const currents = useCurrentPeriods();
  const subjects = useCurrentSubjects();
  const home = useHomePeriod();
  const profile = useProfile();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string>();

  const loading = tracks.isPending || periods.isPending;
  const allTracks = tracks.data ?? [];
  const allPeriods = periods.data ?? [];
  const cards = activeCards(allTracks, currents.data ?? [], subjects.data ?? []);
  const archived = archivedTracks(allTracks);
  const legacy = legacyPlan(allPeriods);
  const loaded = tracks.isSuccess && periods.isSuccess;
  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
  };

  const add = (
    <Button variant="primary" onClick={() => setDialog({ kind: 'add' })}>
      Agregar estudio
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mis estudios"
        description="Lo que estudias ahora. Tu Inicio y tu Agenda siguen siendo uno solo."
        actions={loaded && add}
      />

      {notice && (
        <p role="status" className="rounded-control bg-success-soft p-3 text-sm text-success-ink">
          {notice}
        </p>
      )}

      {loading && <p role="status">Cargando tus estudios…</p>}
      <QueryError query={tracks} title="No se pudieron cargar tus estudios" />
      <QueryError query={periods} title="No se pudieron cargar tus periodos" />
      <QueryError query={currents} title="No se pudo cargar el periodo actual de tus estudios" />
      <QueryError query={subjects} title="No se pudieron contar tus materias" />

      {loaded && home.isSuccess && home.data === null && (
        <p
          role="status"
          className="rounded-control border border-warning-line bg-warning-soft p-3 text-sm text-warning-ink"
        >
          Tu estudio principal todavía no tiene un periodo actual. Elige o crea uno aquí; mientras
          tanto, la app te pedirá un periodo al entrar al Inicio.
        </p>
      )}

      {loaded && legacy && (
        <LegacyPlanCard
          period={legacy}
          subjectCount={(subjects.data ?? []).filter((s) => s.periodId === legacy.id).length}
          onConvert={() =>
            setDialog({
              kind: 'adopt',
              period: legacy,
              suggestion: suggestStudy(profile.data, legacy),
            })
          }
        />
      )}

      {loaded && cards.length > 0 && (
        <section aria-labelledby="active-studies-title" className="flex flex-col gap-3">
          <h2 id="active-studies-title" className="text-section-title">
            Estudios activos
          </h2>
          <ul className="flex flex-col gap-3">
            {cards.map((card) => (
              <StudyCard
                key={card.track.id}
                card={card}
                canOpenSubjects={home.data != null}
                onEdit={() => setDialog({ kind: 'edit', track: card.track })}
                onPeriods={() => setDialog({ kind: 'periods', track: card.track })}
                onPrimary={() =>
                  setDialog({ kind: 'action', action: 'primary', track: card.track })
                }
                onArchive={() =>
                  setDialog({ kind: 'action', action: 'archive', track: card.track })
                }
              />
            ))}
          </ul>
        </section>
      )}

      {loaded && cards.length === 0 && !legacy && (
        <EmptyState
          title={archived.length > 0 ? 'No tienes estudios activos.' : 'Aún no tienes estudios.'}
          action={add}
        >
          Agrega lo que estudias (una carrera, el colegio, un curso) con su periodo y sus materias.
        </EmptyState>
      )}

      {loaded && archived.length > 0 && (
        <section aria-labelledby="archived-studies-title" className="flex flex-col gap-3">
          <h2 id="archived-studies-title" className="text-section-title">
            Archivados
          </h2>
          <ul className="flex flex-col gap-2">
            {archived.map((track) => (
              <Card
                as="li"
                key={track.id}
                variant="soft"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{track.name}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{typeLabel(track.type)}</span>
                    <Badge>Archivado</Badge>
                  </p>
                </div>
                <Button
                  size="sm"
                  aria-label={`Restaurar ${track.name}`}
                  onClick={() => setDialog({ kind: 'action', action: 'restore', track })}
                >
                  Restaurar
                </Button>
              </Card>
            ))}
          </ul>
        </section>
      )}

      {dialog?.kind === 'add' && <AddStudyDialog onClose={close} onDone={done} />}
      {dialog?.kind === 'adopt' && (
        <AdoptDialog
          period={dialog.period}
          suggestion={dialog.suggestion}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditStudyDialog track={dialog.track} onClose={close} onDone={done} />
      )}
      {dialog?.kind === 'periods' && (
        <PeriodsDialog
          track={dialog.track}
          periods={periodsOf(allPeriods, dialog.track.id)}
          onClose={close}
          onDone={done}
        />
      )}
      {dialog?.kind === 'action' && (
        <StudyActionDialog
          action={dialog.action}
          track={dialog.track}
          hasOtherActive={cards.some((c) => c.track.id !== dialog.track.id)}
          onClose={close}
          onDone={done}
        />
      )}
    </div>
  );
}
