import type { ComponentPropsWithoutRef } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'critical';

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface text-foreground',
  info: 'border-info-line bg-info-soft text-info-ink',
  success: 'border-success-line bg-success-soft text-success-ink',
  warning: 'border-warning-line bg-warning-soft text-warning-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  /** Solid red: the strongest signal, kept for a condition that already passed (an overdue activity). */
  critical: 'border-danger bg-danger text-primary-foreground',
};

/**
 * A small pill. The color is only a supporting cue: the caller always provides text (and, where it helps, a symbol
 * with `aria-hidden`), so the meaning never depends on color alone.
 */
export function Badge({
  tone = 'neutral',
  className = '',
  ...rest
}: ComponentPropsWithoutRef<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`.trim()}
      {...rest}
    />
  );
}
