import { ApiRequestError } from '../api/client';
import { OFFLINE_MESSAGE } from '../pwa/pwaState';

interface Props {
  /** The query that failed. */
  query: {
    isError: boolean;
    error: Error | null;
    data: unknown;
    refetch: () => unknown;
    isFetching?: boolean;
  };
  /** "No se pudieron cargar tus actividades": what could not be done, said plainly. */
  title: string;
}

const button =
  'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * A failed request, said once and in the right size:
 *  - nothing to show yet -> an alert with the reason and a retry;
 *  - data already on screen (a background refresh failed) -> the data STAYS and a quiet note explains that it may
 *    not be up to date. The student's screen is never replaced by an error because a refresh failed.
 */
export function QueryError({ query, title }: Props) {
  if (!query.isError) return null;
  const unreachable = query.error instanceof ApiRequestError && query.error.status === 0;
  const reason = unreachable ? OFFLINE_MESSAGE : query.error?.message;

  if (query.data !== undefined) {
    return (
      <p role="status" className="text-sm text-slate-700">
        No pudimos actualizar esta información; ves lo último que se cargó.{' '}
        <button type="button" onClick={() => query.refetch()} className={`${button} ml-1`}>
          Reintentar
        </button>
      </p>
    );
  }
  return (
    <div role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
      <p className="mb-2">
        {title}: {reason}
      </p>
      <button type="button" onClick={() => query.refetch()} className={button}>
        Reintentar
      </button>
    </div>
  );
}
