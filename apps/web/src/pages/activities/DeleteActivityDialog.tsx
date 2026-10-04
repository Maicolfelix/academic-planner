import type { Activity } from '@planner/core';
import { useDeleteActivity } from '../../activities/useActivities';
import { Modal } from '../../components/Modal';

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
      <p className="mb-4">Esta acción eliminará la actividad.</p>
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
            remove.mutate(activity.id, { onSuccess: () => onDeleted('Actividad eliminada.') })
          }
          className="min-h-11 rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-60"
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
    </Modal>
  );
}
