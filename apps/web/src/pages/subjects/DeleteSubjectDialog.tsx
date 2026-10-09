import type { Subject } from '@planner/core';
import { useDeleteSubject } from '../../academic/useAcademic';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';

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
      <p className="mb-5 text-foreground">Esta acción eliminará la asignatura.</p>
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
            remove.mutate(subject.id, { onSuccess: () => onDeleted('Asignatura eliminada.') })
          }
        >
          {remove.isPending ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </FormActions>
    </Modal>
  );
}
