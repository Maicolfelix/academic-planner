import type { Activity } from '@planner/core';
import { useDeleteActivity } from '../../activities/useActivities';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';

interface Props {
  activity: Activity;
  onClose: () => void;
  onDeleted: (message: string) => void;
}

/** Cancel comes first so it receives the initial focus: the safe choice is the default one. */
export function DeleteActivityDialog({ activity, onClose, onDeleted }: Props) {
  const remove = useDeleteActivity();

  return (
    <Modal title={`¿Eliminar ${activity.title}?`} onClose={onClose}>
      <p className="mb-5 text-foreground">Esta acción eliminará la actividad.</p>
      {remove.isError && (
        <div className="mb-4">
          <FormError>{remove.error.message}</FormError>
        </div>
      )}
      <FormActions>
        <Button onClick={onClose} disabled={remove.isPending}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(activity.id, { onSuccess: () => onDeleted('Actividad eliminada.') })
          }
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </FormActions>
    </Modal>
  );
}
