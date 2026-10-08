import type { RadarStatus } from '@planner/core';
import { useEffect } from 'react';
import { useAttention } from '../../attention/useAttention';

export type AmbientTone = 'urgent' | 'calm' | 'done' | 'neutral';

/**
 * The mood of the ambient light, derived ONLY from data the Home already has: all done (100 %), something pressing
 * (an overdue activity, or a hero that is overdue or immediate), everything planned or under control, or none of those.
 * Nothing is stored and nothing is invented: it is the same answer the hero and the counters give, as a color.
 */
export function ambientTone(input: {
  percent: number;
  total: number;
  overdue: number;
  status?: RadarStatus;
}): AmbientTone {
  if (input.total > 0 && input.percent === 100) return 'done';
  if (input.overdue > 0 || input.status === 'OVERDUE' || input.status === 'IMMEDIATE')
    return 'urgent';
  if (input.status === 'PLANNABLE' || input.status === 'UNDER_CONTROL') return 'calm';
  return 'neutral';
}

/**
 * Tells the page behind (the AppShell's ambient light) which mood to wear: it sets `data-ambient` on <body>, which
 * plain attribute rules in index.css read (cheaper than a `:has()` over the whole document), and removes it when the
 * Home goes away. It renders nothing. It only exists on the Home while there is data, like the hero.
 */
export function AmbientMood({
  percent,
  total,
  overdue,
}: {
  percent: number;
  total: number;
  overdue: number;
}) {
  const status = useAttention().data?.recommendation?.radarStatus;
  const tone = ambientTone({ percent, total, overdue, status });
  useEffect(() => {
    document.body.dataset.ambient = tone;
    return () => {
      delete document.body.dataset.ambient;
    };
  }, [tone]);
  return null;
}
