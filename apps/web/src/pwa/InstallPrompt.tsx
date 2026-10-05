import { IOS_INSTALL_HINT } from './pwaState';
import { usePwaInstall } from './usePwaInstall';

/** A discreet line, only when installing is actually possible (or, on iOS Safari, a one-line hint). */
export function InstallPrompt() {
  const { ui, install } = usePwaInstall();
  if (ui === 'none') return null;
  return (
    <section aria-label="Instalar la aplicación" className="text-sm text-slate-700">
      {ui === 'prompt' ? (
        <button
          type="button"
          onClick={() => void install()}
          className="min-h-11 rounded-md border border-slate-400 px-4 py-2 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Instalar Academic Planner
        </button>
      ) : (
        <p>{IOS_INSTALL_HINT}</p>
      )}
    </section>
  );
}
