import { SCHEDULE_BLOCK_TYPE_LABELS, type ScheduleBlock } from '@planner/core';
import { Modal } from '../../components/Modal';
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
      <p className="mb-4">
        {block.recurrence
          ? `${what} se repite semanalmente. Se eliminarán todas las apariciones de la agenda.`
          : `Esta acción eliminará el bloque de la agenda (${SCHEDULE_BLOCK_TYPE_LABELS[block.type].toLowerCase()}).`}
      </p>
      {remove.isError && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {remove.error.message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={remove.isPending}
          className="min-h-11 rounded-md border border-slate-400 px-4 py-2 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(block.id, {
              onSuccess: () =>
                onDeleted(block.recurrence ? 'Serie eliminada de la agenda.' : 'Bloque eliminado.'),
            })
          }
          className="min-h-11 rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-60"
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
    </Modal>
  );
}
