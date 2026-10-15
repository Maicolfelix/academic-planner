/**
 * " · Medicina": the study an activity or a class comes from, inline after its subject. `label` is null unless the student has
 * two or more studies with a current period (see `originLabelOf`), and then nothing is drawn, so a simple account sees no
 * change at all. The name is plain text, introduced for assistive technology by a hidden "Estudio:".
 */
export function OriginLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span>
        <span className="sr-only">Estudio: </span>
        {label}
      </span>
    </>
  );
}
