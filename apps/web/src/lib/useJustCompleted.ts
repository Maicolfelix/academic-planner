import type { ActivityStatus } from '@planner/core';
import { useEffect, useRef, useState } from 'react';

/**
 * True for a little over a second right after an activity BECOMES completed (not when it was already completed, and
 * not for any other change): the moment for a small visual confirmation. It only reports; nothing is stored and no
 * interaction is blocked.
 */
export function useJustCompleted(status: ActivityStatus): boolean {
  const previous = useRef(status);
  const [just, setJust] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (was === 'COMPLETED' || status !== 'COMPLETED') return;
    setJust(true);
    const timer = setTimeout(() => setJust(false), 1200);
    return () => clearTimeout(timer);
  }, [status]);

  return just;
}
