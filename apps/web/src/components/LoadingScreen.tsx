import type { ReactNode } from 'react';
import { CompanionSprite } from '../companion/PixelCompanion';

/**
 * The wait between screens: the companion takes steps on the spot while the message says what is happening. The message is
 * the content (read aloud); the walking picture is decoration and, with "reduce motion", a still one.
 */
export function LoadingScreen({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <CompanionSprite state="CALM" walking className="size-24" />
        <div role="status" className="text-muted-foreground">
          {children}
        </div>
      </div>
    </main>
  );
}
