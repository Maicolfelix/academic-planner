import type { ComponentPropsWithoutRef } from 'react';

interface Props extends ComponentPropsWithoutRef<'div'> {
  /** The element to render: a list item, a landmark section… (default `div`). */
  as?: 'div' | 'section' | 'article' | 'li';
  /** `solid` is a surface; `dashed` is an empty state, a place where something is still to be added. */
  variant?: 'solid' | 'dashed';
}

/** A surface: border, radius and background. Padding and layout stay with the caller, and so does all content. */
export function Card({ as = 'div', variant = 'solid', className = '', ...rest }: Props) {
  // The attributes shared by all four elements are the ones typed here, so rendering them as one is safe.
  const Tag = as as 'div';
  const look = variant === 'dashed' ? 'border-dashed' : 'shadow-card';
  return (
    <Tag
      className={`rounded-surface border border-border bg-surface ${look} ${className}`.trim()}
      {...rest}
    />
  );
}
