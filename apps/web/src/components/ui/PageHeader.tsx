import type { ReactNode } from 'react';

/** The top of a screen: the page title (the only `h1`), an optional line under it and the screen's main action. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-page-title">{title}</h1>
        {description && <p className="text-sm text-muted-foreground break-words">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
