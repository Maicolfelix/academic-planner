/**
 * A horizontal bar made of CSS only. It is a real progressbar with a text equivalent: the percentage and the
 * counts are also written next to it, so the meaning never depends on the bar's length or color.
 * It fills once when it appears (a glint crosses it after), like the Home's; with reduced motion it simply is at its value.
 * `color` (a subject's own color) paints the fill; without it the accent gradient is used.
 */
export function ProgressBar({
  percent,
  label,
  valueText,
  color,
}: {
  percent: number;
  /** Accessible name, e.g. "Progreso de Redes". */
  label: string;
  /** e.g. "75 %, 3 de 4 actividades completadas". */
  valueText: string;
  /** A CSS color for the fill (decoration: the numbers say the same). */
  color?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div
        style={{ width: `${percent}%`, ...(color ? { backgroundColor: color } : {}) }}
        className={`relative h-full origin-left animate-fill overflow-hidden rounded-full ${
          color ? '' : 'bg-[linear-gradient(90deg,var(--accent),#4f46e5)]'
        }`}
      >
        {percent > 0 && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1/4 animate-glint bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.55),transparent)]"
          />
        )}
      </div>
    </div>
  );
}
