import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Native <dialog> opened with showModal(): focus is moved inside and trapped, Escape closes it,
 * the page behind becomes inert, and focus returns to the trigger on close. Mount it only while open.
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
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    // React detaches the node before this cleanup runs, so the browser can no longer restore focus
    // by itself: remember the opener and give focus back explicitly.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-300 bg-white p-5 text-slate-900 backdrop:bg-black/40"
    >
      <h2 id={titleId} className="mb-4 text-lg font-semibold break-words">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
