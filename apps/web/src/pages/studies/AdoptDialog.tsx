import { studyTrackNameSchema, type AcademicPeriod, type EducationContext } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import { studyErrorText, type Suggestion } from '../../studies/studyModel';
import { useAdoptPeriod } from '../../studyTracks/useStudyTracks';
import { StudyIdentityFields } from './StudyIdentityFields';

/**
 * "Convertir en estudio": the plan the student already has (a period without a study) becomes the first period of a NEW study.
 * The form starts with a PROPOSAL (the profile's program and what they use the app for, else the period's own name) that is
 * shown, not applied: nothing is written until "Convertir", and every part can be changed. Nothing is copied or recreated.
 */
export function AdoptDialog({
  period,
  suggestion,
  onClose,
  onDone,
}: {
  period: AcademicPeriod;
  suggestion: Suggestion;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const adopt = useAdoptPeriod();
  const [type, setType] = useState<EducationContext | ''>(suggestion.type ?? '');
  const [name, setName] = useState(suggestion.name);
  const [errors, setErrors] = useState<{ type?: string; name?: string }>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    if (adopt.isPending) return;
    const parsed = studyTrackNameSchema.safeParse(name);
    const next = {
      type: type === '' ? 'Elige el tipo de estudio.' : undefined,
      name: parsed.success ? undefined : parsed.error.issues[0]!.message,
    };
    setErrors(next);
    if (next.type || next.name || type === '' || !parsed.success) return;
    // A program the profile took from the catalog travels as its key (the canonical name comes with it) while the name is untouched.
    const catalog = suggestion.programKey !== null && parsed.data === suggestion.name;
    adopt.mutate(
      {
        periodId: period.id,
        type,
        ...(catalog ? { programKey: suggestion.programKey } : { name: parsed.data }),
      },
      {
        onSuccess: (r) =>
          onDone(`«${r.studyTrack.name}» ya es un estudio. No se movió ni se copió nada.`),
      },
    );
  }

  return (
    <Modal title="Convertir en estudio" onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          «{period.name}» pasará a ser el periodo actual de este estudio. Se conservan sus materias,
          actividades y agenda: no se copia ni se borra nada.
        </p>
        <p className="text-sm text-muted-foreground">
          Es una propuesta a partir de lo que ya sabemos de ti; puedes cambiarla.
        </p>
        {adopt.isError && <FormError>{studyErrorText(adopt.error)}</FormError>}
        <StudyIdentityFields
          type={type}
          name={name}
          onType={setType}
          onName={setName}
          errors={errors}
        />
        <FormActions>
          <Button onClick={onClose} disabled={adopt.isPending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={adopt.isPending}
            aria-busy={adopt.isPending || undefined}
          >
            {adopt.isPending ? 'Convirtiendo…' : 'Convertir en estudio'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
