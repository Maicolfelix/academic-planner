import { EDUCATION_CONTEXTS, type EducationContext } from '@planner/core';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/SelectField';
import { typeLabel } from '../../studies/studyModel';

const OPTIONS = EDUCATION_CONTEXTS.map((value) => ({ value, label: typeLabel(value) }));

/**
 * The two things that say WHAT a study is: its type and its name. Used by "Convertir en estudio" and "Editar estudio" (the
 * "Agregar estudio" flow asks them one at a time). The type is a description, never a permission, and `''` means "not chosen
 * yet" (nothing is guessed when nothing says).
 */
export function StudyIdentityFields({
  type,
  name,
  onType,
  onName,
  errors,
}: {
  type: EducationContext | '';
  name: string;
  onType: (type: EducationContext | '') => void;
  onName: (name: string) => void;
  errors: { type?: string; name?: string };
}) {
  return (
    <>
      <SelectField
        id="study-type"
        label="Tipo de estudio"
        value={type}
        onChange={(v) => onType(v as EducationContext | '')}
        options={OPTIONS}
        placeholder="Elige el tipo…"
        error={errors.type}
        required
      />
      <FormField
        id="study-name"
        label="Nombre del estudio"
        value={name}
        onChange={onName}
        maxLength={80}
        autoComplete="off"
        error={errors.name}
        required
      />
    </>
  );
}
