import { studyTrackNameSchema, type EducationContext, type StudyTrack } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import { studyErrorText } from '../../studies/studyModel';
import { useUpdateStudyTrack } from '../../studyTracks/useStudyTracks';
import { StudyIdentityFields } from './StudyIdentityFields';

/**
 * Name and type of a study, nothing else. Only what changed is sent; a name of their own detaches the study from the catalog
 * (the server decides), and changing the type never touches the subjects it already has: they keep the one they were created with.
 */
export function EditStudyDialog({
  track,
  onClose,
  onDone,
}: {
  track: StudyTrack;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const update = useUpdateStudyTrack();
  const [type, setType] = useState<EducationContext | ''>(track.type);
  const [name, setName] = useState(track.name);
  const [errors, setErrors] = useState<{ type?: string; name?: string }>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    const parsed = studyTrackNameSchema.safeParse(name);
    setErrors({ name: parsed.success ? undefined : parsed.error.issues[0]!.message });
    if (!parsed.success || type === '') return;
    const input = {
      ...(parsed.data !== track.name && { name: parsed.data }),
      ...(type !== track.type && { type }),
    };
    if (Object.keys(input).length === 0) return onClose(); // nothing changed
    update.mutate({ id: track.id, input }, { onSuccess: () => onDone('Estudio actualizado.') });
  }

  return (
    <Modal title="Editar estudio" onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {update.isError && <FormError>{studyErrorText(update.error)}</FormError>}
        <StudyIdentityFields
          type={type}
          name={name}
          onType={setType}
          onName={setName}
          errors={errors}
        />
        <p className="text-sm text-muted-foreground">
          Cambiar el tipo no modifica las materias que ya tienes.
        </p>
        <FormActions>
          <Button onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
