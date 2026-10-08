import type { ComponentPropsWithoutRef } from 'react';

interface Props extends ComponentPropsWithoutRef<'div'> {
  /** The element to render: a list item, a landmark section… (default `div`). */
  as?: 'div' | 'section' | 'article' | 'li';
  /**
   * The surface language (one system, not one look per card):
   * - `solid`: a white surface that rests on the page (the default);
   * - `soft`: a quiet, tinted-white surface for things that support the main ones (no border weight);
   * - `tinted`: a surface that carries the accent hue, for the things that are alive (the Radar, the progress);
   * - `success`: the tinted surface in its done hue (a goal reached);
   * - `accent`: a white surface with a lit edge: the place where the student ACTS (capture);
   * - `dashed`: an empty state, a place where something is still to be added.
   * The deep `hero` surface is not a Card: it belongs to the one hero of a screen.
   */
  variant?: 'solid' | 'soft' | 'tinted' | 'success' | 'accent' | 'dashed';
}

const LOOK: Record<NonNullable<Props['variant']>, string> = {
  solid: 'border-border bg-surface shadow-card',
  soft: 'border-border/60 bg-surface/70 shadow-[0_1px_2px_0_rgb(20_26_60/0.03)]',
  tinted:
    'border-accent/20 bg-[linear-gradient(160deg,var(--surface)_0%,var(--accent-soft)_140%)] shadow-card',
  success:
    'border-success-line bg-[linear-gradient(160deg,var(--surface)_0%,var(--success-soft)_140%)] shadow-card',
  accent:
    'relative border-border bg-surface shadow-card before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-[linear-gradient(180deg,var(--accent),var(--primary))] transition-shadow duration-(--duration-normal) ease-standard focus-within:shadow-[0_0_0_3px_rgb(13_148_136/0.2),0_12px_24px_-14px_rgb(20_26_60/0.25)]',
  dashed: 'border-border bg-surface border-dashed',
};

/** A surface: border, radius and background. Padding and layout stay with the caller, and so does all content. */
export function Card({ as = 'div', variant = 'solid', className = '', ...rest }: Props) {
  // The attributes shared by all four elements are the ones typed here, so rendering them as one is safe.
  const Tag = as as 'div';
  return (
    <Tag className={`rounded-surface border ${LOOK[variant]} ${className}`.trim()} {...rest} />
  );
}
