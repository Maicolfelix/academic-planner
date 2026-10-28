import type { ReactNode } from 'react';

/**
 * The top of a screen: a gradient tile with the screen's icon, the page title (the only `h1`), an optional line under it and
 * the screen's main action, closed by a thin row of pixels (the app's signature, shared with the companion). It arrives in
 * order: the tile springs in, the text and the action settle one after the other and the row of pixels draws itself from the
 * left; afterwards a gloss passes over the tile every few seconds (ambient, `motion-safe` only). Nothing here touches the
 * opacity of text, so it is readable from the first frame. The icon is decoration.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && (
          <span
            aria-hidden="true"
            className="relative grid size-12 shrink-0 animate-tile place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,var(--primary),#2a2a86_55%,#0a5f66)] text-primary-foreground shadow-hero [&_svg]:size-6"
          >
            {icon}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.35),transparent)] motion-safe:animate-gloss" />
          </span>
        )}
        <div className="min-w-0 animate-settle [animation-delay:70ms]">
          <h1 className="text-page-title">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground break-words">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="animate-settle [animation-delay:140ms]">{actions}</div>}
      <span
        aria-hidden="true"
        className="pixel-rule h-1 w-full origin-left animate-grow [animation-delay:200ms]"
      />
    </header>
  );
}
