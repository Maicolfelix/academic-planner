import { useCallback, useEffect, useState } from 'react';
import { installUi, isIosDevice, isStandalone, type InstallUi } from './pwaState';

/** The non-standard event Chromium fires when the app can be installed. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standaloneNow = () =>
  isStandalone({
    displayStandalone: window.matchMedia('(display-mode: standalone)').matches,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  });

/** Install state and action. Never blocks anything: the app works the same in the browser. */
export function usePwaInstall(): { ui: InstallUi; install: () => Promise<void> } {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(standaloneNow);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so the install button can trigger it
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    const media = window.matchMedia('(display-mode: standalone)');
    const onMode = () => setInstalled(standaloneNow());
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener('change', onMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onMode);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice; // accepted -> `appinstalled` follows; dismissed -> the browser may offer it again later
    setDeferred(null); // the event can be used once
  }, [deferred]);

  const ui = installUi({
    installed,
    hasPrompt: deferred !== null,
    ios: isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    userAgent: navigator.userAgent,
  });
  return { ui, install };
}
