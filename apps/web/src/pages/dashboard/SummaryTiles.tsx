import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';

type Summary = Dashboard['summary'];

const TILES: { key: keyof Omit<Summary, 'total'>; label: string; symbol: string; to: string }[] = [
  { key: 'pending', label: 'Pendientes', symbol: '○', to: '/activities?status=PENDING' },
  { key: 'inProgress', label: 'En proceso', symbol: '◐', to: '/activities?status=IN_PROGRESS' },
  { key: 'completed', label: 'Finalizadas', symbol: '✓', to: '/activities?status=COMPLETED' },
  { key: 'overdue', label: 'Vencidas', symbol: '⚠', to: '/activities?overdue=true' },
];

const TILE =
  'flex min-h-11 items-center gap-3 rounded-surface border px-3 py-2 shadow-card transition-[transform,background-color] duration-(--duration-fast) ease-standard active:scale-[0.98]';

/** Four compact counters. Each is a link to the matching filtered list; the label is always text. */
export function SummaryTiles({ summary }: { summary: Summary }) {
  return (
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" className="sr-only">
        Resumen del periodo
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map(({ key, label, symbol, to }) => {
          const alert = key === 'overdue' && summary[key] > 0;
          return (
            <li key={key}>
              <Link
                to={to}
                className={`${TILE} ${
                  alert
                    ? 'border-danger-line bg-danger-soft text-danger-ink'
                    : 'border-border bg-surface hover:bg-secondary'
                }`}
              >
                <span className="text-2xl leading-none font-semibold">{summary[key]}</span>
                <span className="text-sm">
                  <span aria-hidden="true">{symbol} </span>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
