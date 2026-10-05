/** Pure helpers for the PWA UI. They take the browser facts as arguments so they are testable without a DOM. */

export const OFFLINE_MESSAGE =
  'Academic Planner está sin conexión. Algunas funciones no están disponibles.';
export const OFFLINE_DETAIL =
  'Puedes abrir Academic Planner, pero necesitas conexión para consultar o modificar tus datos académicos.';
export const IOS_INSTALL_HINT = 'En Safari, usa Compartir → Agregar a pantalla de inicio.';

interface InstallFacts {
  /** `matchMedia('(display-mode: standalone)').matches`. */
  displayStandalone: boolean;
  /** Safari only: `navigator.standalone`. */
  navigatorStandalone?: boolean;
}

/** Already installed and running as its own window. */
export const isStandalone = (f: InstallFacts): boolean =>
  f.displayStandalone || f.navigatorStandalone === true;

/** iPhone/iPad (iPadOS reports itself as a Mac with touch points). */
export const isIosDevice = (userAgent: string, platform: string, maxTouchPoints: number): boolean =>
  /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

/** Chrome/Firefox/Edge on iOS can not add to the home screen from their menu the same way: hint Safari only. */
const isIosSafari = (userAgent: string): boolean => !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);

export type InstallUi = 'none' | 'prompt' | 'ios-hint';

/** What to offer: nothing when installed, the native prompt when the browser gave one, the iOS hint on Safari. */
export function installUi(args: {
  installed: boolean;
  hasPrompt: boolean;
  ios: boolean;
  userAgent: string;
}): InstallUi {
  if (args.installed) return 'none';
  if (args.hasPrompt) return 'prompt';
  if (args.ios && isIosSafari(args.userAgent)) return 'ios-hint';
  return 'none';
}
