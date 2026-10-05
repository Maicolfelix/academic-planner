import { useSyncExternalStore } from 'react';

/**
 * True while the media query matches. Components render ONE layout or the other (never both hidden with CSS), so
 * the accessibility tree and the tests only ever see a single copy of each block.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
