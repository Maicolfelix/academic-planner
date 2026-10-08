export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

// min-h-11 = 44 px: the touch target the whole app already honors. The focus ring comes from the base layer, and the transition leaves outline-color out so the ring never fades in from the text color.
const BASE =
  'inline-flex min-h-11 items-center justify-center rounded-control font-medium transition-[color,background-color,border-color] duration-(--duration-fast) ease-standard disabled:opacity-60';

const SIZE: Record<ButtonSize, string> = {
  md: 'px-4 py-2',
  sm: 'px-3 py-2 text-sm',
};

// `secondary` sets no text color, so a caller can add one (e.g. `text-danger`) without a class fight.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  secondary: 'border border-border-strong hover:bg-secondary',
  ghost: 'hover:bg-secondary',
  danger: 'bg-danger text-primary-foreground hover:bg-danger/90',
};

/**
 * The classes of a button. A `<Button>` uses them, and so does anything that must LOOK like one but be a different
 * element (a router `<Link>` that navigates).
 */
export function buttonStyles({
  variant = 'secondary',
  size = 'md',
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return `${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`.trim();
}
