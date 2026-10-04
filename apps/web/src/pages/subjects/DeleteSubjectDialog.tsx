import type { Subject } from '@planner/core';
import { useDeleteSubject } from '../../academic/useAcademic';
import { Modal } from '../../components/Modal';

interface Props {
  subject: Subject;
  onClose: () => void;
  onDeleted: (message: string) => void;
}

/** Cancel comes first so it receives the initial focus: the safe choice is the default one. */
export function DeleteSubjectDialog({ subject, onClose, onDeleted }: Props) {
  const remove = useDeleteSubject();

  return (
    <Modal title={`¿Eliminar ${subject.name}?`} onClose={onClose}>
      <p className="mb-4">Esta acción eliminará la asignatura.</p>
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
            remove.mutate(subject.id, { onSuccess: () => onDeleted('Asignatura eliminada.') })
          }
          className="min-h-11 rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-60"
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
    </Modal>
  );
}
