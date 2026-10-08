import type { ReactNode } from 'react';
import { Card } from './Card';

/** A small abstract picture (a tilted check over soft shapes). Decoration: hidden from assistive technology. */
function Illustration() {
  return (
    <svg
      viewBox="0 0 120 80"
      aria-hidden="true"
      focusable="false"
      className="mx-auto mb-3 h-16 w-24 animate-pop"
    >
      <circle cx="60" cy="42" r="30" className="fill-accent-soft" />
      <circle cx="98" cy="18" r="6" className="fill-accent/40" />
      <circle cx="20" cy="62" r="4" className="fill-primary/20" />
      <circle cx="104" cy="64" r="3" className="fill-primary/15" />
      <rect
        x="38"
        y="22"
        width="44"
        height="40"
        rx="10"
        transform="rotate(-6 60 42)"
        className="fill-primary"
      />
      <path
        d="m50 43 7 7 14-15"
        transform="rotate(-6 60 42)"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}

/**
 * A place where something is still to be added: a picture, a title, one line and the next step. The title is a
 * paragraph unless the screen wants it as a heading (`titleAs="h2"`), so the page's heading outline does not move.
 */
export function EmptyState({
  title,
  titleAs: Title = 'p',
  children,
  action,
}: {
  title: ReactNode;
  titleAs?: 'p' | 'h2';
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card as="section" variant="dashed" className="animate-rise p-6 text-center">
      <Illustration />
      <Title className="mb-1 text-section-title">{title}</Title>
      {children && <p className="mb-4 text-muted-foreground">{children}</p>}
      {action}
    </Card>
  );
}
