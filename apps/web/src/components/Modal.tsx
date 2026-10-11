import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/Button';

/**
 * Native <dialog> opened with showModal(): focus is moved inside and trapped, the page behind becomes inert and
 * focus returns to the trigger on close. Mount it only while open.
 *
 * Unsaved changes are never lost by accident: once the student has typed or chosen anything inside, Escape and a
 * click on the backdrop do NOT close the dialog; they ask first ("Seguir editando" is the default choice). The
 * explicit "Cancelar" button of a form always closes, and a dialog without fields (a delete confirmation) closes
 * as before. "Changed" means an input/change event happened inside: simple and uniform for every form.
 *
 * Its look is Pulso Ambiental: a white surface with a thin accent edge on top, an indigo veil behind (no blur: it is
 * costly and adds nothing), and a short fade-and-rise on opening (it closes at once: it is unmounted). On a phone it stays
 * a CENTERED dialog with a margin all round (never flush with the bar or the home indicator) and scrolls inside when a
 * form is taller than the screen; the width fits a form from 320 px up to a comfortable 31 rem.
 */
export function Modal({
  title,
  onClose,
  children,
  keepsWork = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * The form keeps what is typed as a draft: closing it (Escape, the backdrop) loses nothing, so it does not ask. Discarding
   * is then an explicit act of the form itself.
   */
  keepsWork?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    // React detaches the node before this cleanup runs, so the browser can no longer restore focus
    // by itself: remember the opener and give focus back explicitly.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      // If the opener is gone (e.g. the empty-state button was replaced by the list), land on the page content.
      if (opener?.isConnected) opener.focus();
      else document.getElementById('contenido')?.focus();
    };
  }, []);

  // The question gets the focus, on its safe answer.
  useEffect(() => {
    if (asking) keepEditing.current?.focus();
  }, [asking]);

  const requestClose = () => (dirty && !keepsWork ? setAsking(true) : onClose());

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) requestClose(); // click on the backdrop
      }}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(31rem,calc(100vw-2rem))] animate-dialog overflow-y-auto rounded-surface border border-border/70 bg-surface-elevated p-5 text-foreground shadow-floating backdrop:bg-[rgb(20_26_60/0.5)] sm:p-6"
    >
      {/* A thin accent edge: decoration, hidden from assistive technology. (No `relative` on the dialog: a modal dialog is
          already `position: fixed` and that is what centers it; overriding it pushed tall ones off the top of the screen.) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--accent),var(--primary))]"
      />
      <h2 id={titleId} className="mb-4 text-section-title break-words">
        {title}
      </h2>
      {asking && (
        <div
          role="alert"
          className="mb-4 flex flex-col gap-3 rounded-control border border-warning-line bg-warning-soft p-3 text-sm text-warning-ink"
        >
          <p>Tienes cambios sin guardar. ¿Quieres descartarlos?</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={keepEditing} variant="primary" onClick={() => setAsking(false)}>
              Seguir editando
            </Button>
            <Button onClick={onClose} className="border-danger bg-surface text-danger-ink">
              Descartar cambios
            </Button>
          </div>
        </div>
      )}
      {children}
    </dialog>
  );
}
