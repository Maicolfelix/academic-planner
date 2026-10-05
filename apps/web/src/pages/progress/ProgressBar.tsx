/**
 * A horizontal bar made of CSS only. It is a real progressbar with a text equivalent: the percentage and the
 * counts are also written next to it, so the meaning never depends on the bar's length or color.
 */
export function ProgressBar({
  percent,
  label,
  valueText,
}: {
  percent: number;
  /** Accessible name, e.g. "Progreso de Redes". */
  label: string;
  /** e.g. "75 %, 3 de 4 actividades completadas". */
  valueText: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <div style={{ width: `${percent}%` }} className="h-full rounded-full bg-slate-900" />
    </div>
  );
}
