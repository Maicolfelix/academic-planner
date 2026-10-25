import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';

type Summary = Dashboard['summary'];

// Open work by state, nothing else: each concept is said ONCE on the Home. "Finalizadas" is the Progress card's own
// figure, and "Vencidas" belongs to the Radar (same count, same filtered list). Each metric has a hue of its own, used for
// the numeral and for the thin bar under it once it has something to show (a zero stays quiet).
const METRICS: {
  key: 'pending' | 'inProgress';
  label: string;
  symbol: string;
  to: string;
  ink: string;
  bar: string;
}[] = [
  {
    key: 'pending',
    label: 'Pendientes',
    symbol: '○',
    to: '/activities?status=PENDING',
    ink: 'text-primary',
    bar: 'bg-primary/70',
  },
  {
    key: 'inProgress',
    label: 'En proceso',
    symbol: '◐',
    to: '/activities?status=IN_PROGRESS',
    ink: 'text-info-ink',
    bar: 'bg-info',
  },
];

/**
 * The open work as ONE editorial strip: two big numerals separated by a hairline. Under each number, a thin bar says what share of the
 * period's activities it is. Each cell is a link to the matching filtered list; the label is always text, and the bar
 * and the symbol are decoration.
 */
export function SummaryTiles({
  summary,
  several = false,
}: {
  summary: Summary;
  several?: boolean;
}) {
  return (
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" className="sr-only">
        {several ? 'Resumen de tus estudios actuales' : 'Resumen del periodo'}
      </h2>
      <ul className="grid animate-rise grid-cols-2 gap-px overflow-hidden rounded-surface border border-border bg-border shadow-card [animation-delay:80ms]">
        {METRICS.map(({ key, label, symbol, to, ink, bar }, i) => {
          const count = summary[key];
          const share = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
          return (
            <li key={key} className="bg-surface">
              <Link
                to={to}
                className="group flex h-full min-h-20 flex-col justify-between gap-2 px-4 py-3 transition-[background-color,transform] duration-(--duration-fast) ease-standard hover:bg-primary/5 active:scale-[0.98]"
              >
                <span
                  className={`text-3xl leading-none font-semibold tabular-nums ${
                    count > 0 ? ink : 'text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
                <span className="flex flex-col gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-0.5 w-full overflow-hidden rounded-full bg-secondary"
                  >
                    <span
                      className={`block h-full origin-left animate-fill rounded-full ${bar}`}
                      style={{
                        width: `${count > 0 ? Math.max(share, 8) : 0}%`,
                        animationDelay: `${160 + i * 60}ms`,
                      }}
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="mr-1 inline-block transition-transform duration-(--duration-fast) ease-spring group-hover:scale-125"
                    >
                      {symbol}
                    </span>
                    {label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
