import { CaptureFlow } from '../../capture/CaptureFlow';
import { SparkIcon } from '../../components/ui/icons';

/**
 * Quick capture: write what you have to do, in your own words — one activity or several, in any order — and the app reads
 * it, shows what it understood and creates it all with one confirmation. It is the same flow (and the same review) as the
 * Academic Inbox; only the box is smaller.
 */
export function QuickCapture() {
  return (
    <section aria-labelledby="quick-capture-title" className="flex flex-col gap-2">
      <h2 id="quick-capture-title" className="flex items-center gap-2 text-lg font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <SparkIcon className="size-4" />
        </span>
        Captura rápida
      </h2>
      <CaptureFlow
        mode="QUICK"
        label="Escribe lo que tienes pendiente"
        placeholder="Ej: parcial de redes el martes a las 10 am y tarea de programación el viernes"
        rows={3}
        help="Puede ser una actividad o varias, con sus días y horas. Se interpreta aquí mismo, sin enviar el texto a ningún servicio externo. Nada se guarda hasta que confirmes."
        submitLabel="Interpretar"
        level={3}
      />
    </section>
  );
}
