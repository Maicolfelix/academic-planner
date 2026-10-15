import { type StudyTrack } from '@planner/core';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import { studyErrorText } from '../../studies/studyModel';
import {
  useArchiveStudyTrack,
  useMakeStudyTrackPrimary,
  useRestoreStudyTrack,
} from '../../studyTracks/useStudyTracks';

export type StudyAction = 'primary' | 'archive' | 'restore';

const COPY: Record<
  StudyAction,
  { title: (name: string) => string; confirm: string; busy: string }
> = {
  primary: {
    title: (n) => `¿Hacer principal «${n}»?`,
    confirm: 'Hacer principal',
    busy: 'Guardando…',
  },
  archive: { title: (n) => `¿Archivar «${n}»?`, confirm: 'Archivar', busy: 'Archivando…' },
  restore: { title: (n) => `¿Restaurar «${n}»?`, confirm: 'Restaurar', busy: 'Restaurando…' },
};

/**
 * A light confirmation for the three actions that change which study is the main one or which studies appear in the summaries.
 * "Cancelar" comes first (the safe answer takes the focus). Failures are said in plain words: a primary study that still has
 * company cannot be archived until another one takes its place.
 */
export function StudyActionDialog({
  action,
  track,
  hasOtherActive,
  onClose,
  onDone,
}: {
  action: StudyAction;
  track: StudyTrack;
  /** Another ACTIVE study exists (so archiving the main one needs a replacement first). */
  hasOtherActive: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const primary = useMakeStudyTrackPrimary();
  const archive = useArchiveStudyTrack();
  const restore = useRestoreStudyTrack();
  const run = action === 'primary' ? primary : action === 'archive' ? archive : restore;
  const copy = COPY[action];
  const done = {
    primary: `«${track.name}» es ahora tu estudio principal.`,
    archive: `«${track.name}» quedó archivado. Tus datos no se borraron.`,
    restore: `«${track.name}» volvió a tus estudios. Elige o crea su periodo actual.`,
  }[action];

  return (
    <Modal title={copy.title(track.name)} onClose={onClose}>
      <div className="mb-5 flex flex-col gap-2 text-foreground">
        {action === 'primary' && (
          <p>
            Tu estudio principal es el que usa la app cuando no le dices otro: ahí se guardan por
            defecto tus cosas nuevas. Tus demás estudios siguen apareciendo en los resúmenes.
          </p>
        )}
        {action === 'archive' && (
          <>
            <p>Dejará de aparecer en tus resúmenes actuales. Tus datos no se borrarán.</p>
            {track.isPrimary && hasOtherActive && (
              <p className="text-sm text-muted-foreground">
                Es tu estudio principal: elige primero otro como principal.
              </p>
            )}
            {track.isPrimary && !hasOtherActive && (
              <p className="text-sm text-muted-foreground">
                Es tu único estudio activo. Al archivarlo, la app te pedirá un periodo actual la
                próxima vez que entres al Inicio.
              </p>
            )}
          </>
        )}
        {action === 'restore' && (
          <p>
            Volverá a tus estudios, pero no se reactiva ningún periodo: podrás elegir o crear el
            actual.
          </p>
        )}
      </div>
      {run.isError && (
        <div className="mb-4">
          <FormError>{studyErrorText(run.error)}</FormError>
        </div>
      )}
      <FormActions>
        <Button onClick={onClose} disabled={run.isPending}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          disabled={run.isPending}
          aria-busy={run.isPending || undefined}
          onClick={() => run.mutate(track.id, { onSuccess: () => onDone(done) })}
        >
          {run.isPending ? copy.busy : copy.confirm}
        </Button>
      </FormActions>
    </Modal>
  );
}
