import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Native <dialog> opened with showModal(): focus is moved inside and trapped, the page behind becomes inert and
 * focus returns to the trigger on close. Mount it only while open.
 *
 * Unsaved changes are never lost by accident: once the student has typed or chosen anything inside, Escape and a
 * click on the backdrop do NOT close the dialog; they ask first ("Seguir editando" is the default choice). The
 * explicit "Cancelar" button of a form always closes, and a dialog without fields (a delete confirmation) closes
 * as before. "Changed" means an input/change event happened inside: simple and uniform for every form.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
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

  const requestClose = () => (dirty ? setAsking(true) : onClose());

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
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-surface border border-border bg-surface-elevated p-5 text-foreground shadow-floating backdrop:bg-black/40"
    >
      <h2 id={titleId} className="mb-4 text-section-title break-words">
        {title}
      </h2>
      {asking && (
        <div
          role="alert"
          className="mb-4 flex flex-col gap-3 rounded-md border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p>Tienes cambios sin guardar. ¿Quieres descartarlos?</p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={keepEditing}
              type="button"
              onClick={() => setAsking(false)}
              className="min-h-11 rounded-md bg-slate-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              Seguir editando
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-md border border-red-700 px-4 py-2 font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              Descartar cambios
            </button>
          </div>
        </div>
      )}
      {children}
    </dialog>
  );
}
