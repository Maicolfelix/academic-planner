import type { Dashboard } from '@planner/core';
import { Link } from 'react-router';
import { INTERACTIVE_TILE } from '../../components/ui/interactive';

type Summary = Dashboard['summary'];

// `tint` colors a tile once it has something to show (a zero stays plain white); the label is always text.
const TILES: {
  key: keyof Omit<Summary, 'total'>;
  label: string;
  symbol: string;
  to: string;
  tint: string;
}[] = [
  {
    key: 'pending',
    label: 'Pendientes',
    symbol: '○',
    to: '/activities?status=PENDING',
    tint: 'border-border bg-secondary',
  },
  {
    key: 'inProgress',
    label: 'En proceso',
    symbol: '◐',
    to: '/activities?status=IN_PROGRESS',
    tint: 'border-info-line bg-info-soft text-info-ink',
  },
  {
    key: 'completed',
    label: 'Finalizadas',
    symbol: '✓',
    to: '/activities?status=COMPLETED',
    tint: 'border-success-line bg-success-soft text-success-ink',
  },
  {
    key: 'overdue',
    label: 'Vencidas',
    symbol: '⚠',
    to: '/activities?overdue=true',
    tint: 'border-danger-line bg-danger-soft text-danger-ink',
  },
];

const TILE = `group flex min-h-11 items-center gap-3 rounded-surface border px-3 py-2 shadow-card ${INTERACTIVE_TILE}`;

/** Four compact counters. Each is a link to the matching filtered list; the label is always text. */
export function SummaryTiles({ summary }: { summary: Summary }) {
  return (
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" className="sr-only">
        Resumen del periodo
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map(({ key, label, symbol, to, tint }) => {
          return (
            <li key={key}>
              <Link
                to={to}
                className={`${TILE} ${
                  summary[key] > 0 ? tint : 'border-border bg-surface text-muted-foreground'
                }`}
              >
                <span className="text-2xl leading-none font-semibold">{summary[key]}</span>
                <span className="text-sm">
                  <span
                    aria-hidden="true"
                    className="inline-block transition-transform duration-(--duration-fast) ease-spring group-hover:scale-125"
                  >
                    {symbol}{' '}
                  </span>
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
