import type { ReactNode } from 'react';
import { AlertIcon, ChevronDownIcon } from './icons';

/*
 * The small pieces every form of the app repeats. They are deliberately tiny and know nothing about fields, schemas or
 * validation (no form engine): each is a bit of layout and a bit of dress around the NATIVE controls.
 */

/** The message under a field: an icon AND the words, so an error is never only a color. Linked with `aria-describedby`. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger-ink">
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The message of a whole form that failed (a server error, not tied to one field). Announced at once (`role="alert"`). */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * Optional fields behind one tap ("Más opciones"). Still a native `<details>` and `<summary>` (keyboard, screen reader and
 * find-in-page for free); the summary is a 44 px row on a soft surface, the chevron turns when it opens and the content
 * rises in once (it is not rendered while closed, so the animation plays on opening). `open` only sets the STARTING state:
 * a form passes it when the student already has something in there.
 */
export function Disclosure({
  summary,
  open,
  children,
}: {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open || undefined}
      className="group rounded-surface border border-border bg-secondary/40"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-surface px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast) ease-standard hover:bg-secondary/70 [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{summary}</span>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-(--duration-normal) ease-standard group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 px-3 pt-1 pb-3 group-open:animate-rise">{children}</div>
    </details>
  );
}

/**
 * The footer of a form or a confirmation: the same everywhere. The answer that leaves ("Cancelar") comes BEFORE the one
 * that commits, both to the right; a destructive shortcut (`start`, e.g. "Eliminar" inside the block editor) goes to the
 * left, apart from them. On a phone the two main buttons share the row and are wide targets.
 */
export function FormActions({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
      {start && <div className="mr-auto max-sm:w-full">{start}</div>}
      <div className="ml-auto flex flex-wrap gap-2 max-sm:w-full max-sm:flex-nowrap max-sm:*:flex-1">
        {children}
      </div>
    </div>
  );
}
