import { buttonStyles } from '../components/ui/buttonStyles';
import { IOS_INSTALL_HINT } from './pwaState';
import { usePwaInstall } from './usePwaInstall';

/** A discreet line, only when installing is actually possible (or, on iOS Safari, a one-line hint). */
export function InstallPrompt() {
  const { ui, install } = usePwaInstall();
  if (ui === 'none') return null;
  return (
    <section aria-label="Instalar la aplicación" className="text-sm text-muted-foreground">
      {ui === 'prompt' ? (
        <button type="button" onClick={() => void install()} className={buttonStyles()}>
          Instalar Academic Planner
        </button>
      ) : (
        <p>{IOS_INSTALL_HINT}</p>
      )}
    </section>
  );
}
