/**
 * The response of a tappable card or tile (a counter, a Radar category): it lifts a little under a mouse, settles
 * when pressed and comes back. Transform and shadow only; with reduced motion the change is instant.
 * Level 1 (a card at rest) -> level 2 (lifted: `shadow-lift`).
 */
export const INTERACTIVE_TILE =
  'transition-[transform,box-shadow,background-color] duration-(--duration-fast) ease-standard hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0 active:scale-[0.98]';
