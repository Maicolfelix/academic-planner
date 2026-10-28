import type { ReactNode } from 'react';

/**
 * The top of a screen: a gradient tile with the screen's icon, the page title (the only `h1`), an optional line under it and
 * the screen's main action, closed by a thin row of pixels (the app's signature, shared with the companion). It settles
 * into place with a rise that never touches opacity, so the text is readable from the first frame. The icon is decoration.
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
    <header className="flex animate-settle flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && (
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--primary),#2a2a86_55%,#0a5f66)] text-primary-foreground shadow-hero [&_svg]:size-6"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-page-title">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground break-words">{description}</p>
          )}
        </div>
      </div>
      {actions}
      <span aria-hidden="true" className="pixel-rule h-1 w-full" />
    </header>
  );
}
