import { SCHEDULE_BLOCK_TYPE_LABELS, type ScheduleBlock } from '@planner/core';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import { useDeleteScheduleBlock } from '../../schedule/useSchedule';

interface Props {
  block: ScheduleBlock;
  onClose: () => void;
  onDeleted: (message: string) => void;
}

/** Cancel comes first so it receives the initial focus: the safe choice is the default one. */
export function DeleteBlockDialog({ block, onClose, onDeleted }: Props) {
  const remove = useDeleteScheduleBlock();
  const what = block.type === 'CLASS' ? 'Esta clase' : 'Este bloque';

  return (
    <Modal title={`¿Eliminar ${block.title}?`} onClose={onClose}>
      <p className="mb-5 text-foreground">
        {block.recurrence
          ? `${what} se repite semanalmente. Se eliminarán todas las apariciones de la agenda.`
          : `Esta acción eliminará el bloque de la agenda (${SCHEDULE_BLOCK_TYPE_LABELS[block.type].toLowerCase()}).`}
      </p>
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
            remove.mutate(block.id, {
              onSuccess: () =>
                onDeleted(block.recurrence ? 'Serie eliminada de la agenda.' : 'Bloque eliminado.'),
            })
          }
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </FormActions>
    </Modal>
  );
}
