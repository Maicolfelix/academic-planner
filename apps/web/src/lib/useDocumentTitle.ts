import { useEffect } from 'react';

const BRAND = 'Academic Planner';

/** One title per screen ("Agenda · Academic Planner"): it is what a screen reader announces on navigation. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND}` : BRAND;
  }, [title]);
}
