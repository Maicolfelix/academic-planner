import type { Subject } from '@planner/core';
import { useDeleteSubject } from '../../academic/useAcademic';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';

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
        <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 text-sm text-danger-ink">
          {remove.error.message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={remove.isPending}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(subject.id, { onSuccess: () => onDeleted('Asignatura eliminada.') })
          }
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </div>
    </Modal>
  );
}
