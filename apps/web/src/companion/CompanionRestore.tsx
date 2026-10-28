import { useCompanionHidden, writeCompanionHidden } from './companionPrefs';

/** Shown on the Home only when the student hid the roaming companion: the way back. Nothing otherwise. */
export function CompanionRestore() {
  const hidden = useCompanionHidden();
  if (!hidden) return null;
  return (
    <button
      type="button"
      onClick={() => writeCompanionHidden(false)}
      className="mt-2 min-h-11 rounded-md text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Que mi compañero me acompañe por la app
    </button>
  );
}
