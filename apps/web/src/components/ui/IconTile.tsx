import type { ReactNode } from 'react';

const TONE = {
  primary:
    'bg-[linear-gradient(135deg,var(--primary),#2a2a86_60%,#0a5f66)] text-primary-foreground',
  accent: 'bg-accent-soft text-accent-ink',
  warm: 'bg-[linear-gradient(135deg,#f59e0b,#ea580c)] text-white',
} as const;

/**
 * The small tile that opens a section's heading: a pixel picture on a rounded square, the same hand as the tile of a screen's
 * header, only smaller. Decoration (the heading says it all): hidden from assistive technology.
 */
export function IconTile({
  children,
  tone = 'primary',
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-8 shrink-0 place-items-center rounded-xl shadow-[2px_2px_0_0_rgb(31_38_112/0.18)] [&_svg]:size-4 ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
