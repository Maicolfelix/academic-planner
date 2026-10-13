import { Button } from '../components/ui/Button';
import { CheckIcon } from '../components/ui/icons';

interface Props {
  /** What the subjects step did, when it did something. */
  subjects?: { created: number; reused: number };
  pending: boolean;
  error?: string;
  onImport: () => void;
  onHome: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The last screen is small on purpose (no celebration): two ways out. Both finish the wizard; "Importar mi horario" only
 * takes the student to the import, which they review and confirm themselves (nothing is imported here).
 */
export function FinalStep({ subjects, pending, error, onImport, onHome }: Props) {
  const created = subjects?.created ?? 0;
  const reused = subjects?.reused ?? 0;
  return (
    <>
      {(created > 0 || reused > 0) && (
        <p role="status" className="flex items-start gap-2 text-sm">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success-ink" />
          <span>
            {created > 0 && `${plural(created, 'materia agregada', 'materias agregadas')}`}
            {created > 0 && reused > 0 && ' · '}
            {reused > 0 && `${plural(reused, 'ya estaba', 'ya estaban')} en tu periodo`}
          </span>
        </p>
      )}
      <p className="text-muted-foreground">Puedes cambiar todo esto después.</p>

      {error && (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
        >
          {error} Vuelve a intentarlo.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" onClick={onImport} disabled={pending}>
          Importar mi horario
        </Button>
        <Button onClick={onHome} disabled={pending}>
          Ir al Inicio
        </Button>
      </div>
    </>
  );
}
