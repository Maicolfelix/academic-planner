import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';

type Summary = Dashboard['summary'];

// Each metric has a hue of its own, used for the numeral and for the thin bar under it once it has something to show
// (a zero stays quiet). `cell` tints the whole cell: only "Vencidas" does, and only when there are some.
const METRICS: {
  key: keyof Omit<Summary, 'total'>;
  label: string;
  symbol: string;
  to: string;
  ink: string;
  bar: string;
  cell: string;
}[] = [
  {
    key: 'pending',
    label: 'Pendientes',
    symbol: '○',
    to: '/activities?status=PENDING',
    ink: 'text-primary',
    bar: 'bg-primary/70',
    cell: 'bg-surface',
  },
  {
    key: 'inProgress',
    label: 'En proceso',
    symbol: '◐',
    to: '/activities?status=IN_PROGRESS',
    ink: 'text-info-ink',
    bar: 'bg-info',
    cell: 'bg-surface',
  },
  {
    key: 'completed',
    label: 'Finalizadas',
    symbol: '✓',
    to: '/activities?status=COMPLETED',
    ink: 'text-success-ink',
    bar: 'bg-success',
    cell: 'bg-surface',
  },
  {
    key: 'overdue',
    label: 'Vencidas',
    symbol: '⚠',
    to: '/activities?overdue=true',
    ink: 'text-danger-ink',
    bar: 'bg-danger',
    cell: 'bg-danger-soft',
  },
];

/**
 * Four counters as ONE editorial strip, not four boxes: big numerals separated by hairlines (two by two on a phone
 * and in the desktop side column, four in a row between). Under each number, a thin bar says what share of the
 * period's activities it is. Each cell is a link to the matching filtered list; the label is always text, and the bar
 * and the symbol are decoration.
 */
export function SummaryTiles({ summary }: { summary: Summary }) {
  return (
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" className="sr-only">
        Resumen del periodo
      </h2>
      <ul className="grid animate-rise grid-cols-2 gap-px overflow-hidden rounded-surface border border-border bg-border shadow-card [animation-delay:80ms] sm:grid-cols-4 lg:grid-cols-2">
        {METRICS.map(({ key, label, symbol, to, ink, bar, cell }, i) => {
          const count = summary[key];
          const share = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
          return (
            <li key={key} className={count > 0 && key === 'overdue' ? cell : 'bg-surface'}>
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
