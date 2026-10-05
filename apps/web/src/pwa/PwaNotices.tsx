import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { OFFLINE_DETAIL, OFFLINE_MESSAGE } from './pwaState';
import { useOnlineStatus } from './useOnlineStatus';

const HOUR = 60 * 60 * 1000;
const button =
  'min-h-11 rounded-md border border-current px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * Two discreet notices above the app, in the normal flow (they never cover the navigation or a form):
 * - offline (`navigator.onLine === false`), with text, announced once when it appears;
 * - a new version is ready. The update is NEVER applied on its own: reloading could lose a form being edited.
 */
export function PwaNotices() {
  const online = useOnlineStatus();
  const [later, setLater] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version now and then, so a long-lived tab does not stay old forever.
      if (registration) setInterval(() => void registration.update().catch(() => undefined), HOUR);
    },
  });

  return (
    <>
      {!online && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-sm text-amber-950">
          <p className="mx-auto max-w-3xl">
            <strong>Sin conexión.</strong> {OFFLINE_MESSAGE} {OFFLINE_DETAIL}
          </p>
        </div>
      )}
      {needRefresh && !later && (
        <div role="status" className="bg-sky-100 px-4 py-2 text-sm text-sky-950">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
            <p className="mr-auto">
              <strong>Nueva versión disponible.</strong> Al actualizar se recargará la página:
              termina lo que estés escribiendo antes.
            </p>
            <button type="button" onClick={() => void updateServiceWorker(true)} className={button}>
              Actualizar ahora
            </button>
            <button type="button" onClick={() => setLater(true)} className={button}>
              Más tarde
            </button>
          </div>
        </div>
      )}
    </>
  );
}
