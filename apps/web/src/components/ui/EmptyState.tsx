import type { ReactNode } from 'react';
import { Card } from './Card';
import { PIXELS, PixelIcon } from './icons';

/** Four little stars around the object: where they sit, how big and when each one lights up. Decoration. */
const STARS = [
  { at: 'top-3 left-5', size: 'size-1.5', tone: 'bg-accent', delay: '0s' },
  { at: 'top-6 right-6', size: 'size-1', tone: 'bg-primary/50', delay: '1.1s' },
  { at: 'bottom-8 left-3', size: 'size-1', tone: 'bg-primary/50', delay: '2.2s' },
  { at: 'bottom-5 right-4', size: 'size-1.5', tone: 'bg-accent', delay: '0.6s' },
] as const;

/**
 * A little pixel scene: the thing that is still to come (a checklist, a book, a cap...) drawn in the same squares as the
 * companion, floating over its own shadow, with a second, paler copy one square behind it for depth and four stars that
 * light up in turn. The object bobs by whole squares; with "reduce motion" the scene is a still picture. Decoration: the
 * picture is hidden from assistive technology and the title says what it is.
 */
function Scene({ art }: { art: keyof typeof PIXELS }) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto mb-4 grid h-36 w-52 animate-pop place-items-center overflow-hidden rounded-2xl bg-[radial-gradient(80%_90%_at_50%_100%,var(--accent-soft),transparent_75%)]"
    >
      {STARS.map((s) => (
        <span
          key={s.at}
          style={{ animationDelay: s.delay }}
          className={`absolute ${s.at} ${s.size} ${s.tone} motion-safe:animate-companion-twinkle`}
        />
      ))}
      <span className="absolute bottom-5 h-2 w-16 bg-primary/10" />
      <div className="relative motion-safe:animate-bob">
        <PixelIcon
          rows={PIXELS[art]}
          className="absolute top-1.5 left-1.5 size-20 text-accent/30"
        />
        <PixelIcon rows={PIXELS[art]} className="relative size-20 text-primary" />
      </div>
    </div>
  );
}

/**
 * A place where something is still to be added: a pixel scene, a title, one line and the next step. The title is a
 * paragraph unless the screen wants it as a heading (`titleAs="h2"`), so the page's heading outline does not move.
 * `art` picks the object of the scene (the checklist by default).
 */
export function EmptyState({
  title,
  titleAs: Title = 'p',
  art = 'check',
  children,
  action,
}: {
  title: ReactNode;
  titleAs?: 'p' | 'h2';
  art?: keyof typeof PIXELS;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card as="section" variant="dashed" className="animate-rise p-6 text-center">
      <Scene art={art} />
      <Title className="mb-1 text-section-title">{title}</Title>
      {children && <p className="mb-4 text-muted-foreground">{children}</p>}
      {action}
    </Card>
  );
}
