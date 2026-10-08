import type { ReactNode } from 'react';
import { Card } from './Card';

/**
 * A small constellation: three nodes circling the thing that is still to come (a checked square), with a ring that
 * leaves it now and then. The orbit and the ring are ambient motion (never with reduced motion). Decoration: hidden
 * from assistive technology.
 */
function Illustration() {
  return (
    <svg
      viewBox="0 0 120 80"
      aria-hidden="true"
      focusable="false"
      className="mx-auto mb-3 h-20 w-32 animate-pop"
    >
      <circle cx="60" cy="40" r="32" className="fill-accent-soft" />
      <ellipse
        cx="60"
        cy="40"
        rx="46"
        ry="17"
        transform="rotate(-18 60 40)"
        fill="none"
        strokeWidth="1"
        className="stroke-primary/20"
      />
      <ellipse
        cx="60"
        cy="40"
        rx="40"
        ry="14"
        transform="rotate(26 60 40)"
        fill="none"
        strokeWidth="1"
        strokeDasharray="2 4"
        className="stroke-accent/40"
      />
      <g className="[transform-origin:60px_40px] motion-safe:animate-orbit">
        <circle cx="96" cy="40" r="3.5" className="fill-accent" />
        <circle cx="42" cy="68" r="2.5" className="fill-primary/40" />
        <circle cx="30" cy="20" r="3" className="fill-primary/25" />
      </g>
      <circle
        cx="60"
        cy="40"
        r="20"
        fill="none"
        strokeWidth="2"
        className="origin-center stroke-accent opacity-0 [transform-box:fill-box] motion-safe:animate-halo"
      />
      <rect
        x="40"
        y="22"
        width="40"
        height="36"
        rx="10"
        transform="rotate(-6 60 40)"
        className="fill-primary"
      />
      <path
        d="m51 41 6 6 13-13"
        transform="rotate(-6 60 40)"
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
