import { Link } from 'react-router';
import { useRadar } from '../../radar/useRadar';
import { RadarSummary } from './RadarSummary';

/** Compact Dashboard summary of the Radar. The detail lives in /radar and in the filtered Activities list. */
export function RadarCard() {
  const radar = useRadar();

  return (
    <section aria-labelledby="radar-title" className="flex flex-col gap-2">
      <h2 id="radar-title" className="text-lg font-semibold">
        Radar académico
      </h2>
      {radar.isPending && <p role="status">Cargando Radar…</p>}
      {radar.isError && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-2">No se pudo cargar el Radar: {radar.error.message}</p>
          <button
            type="button"
            onClick={() => radar.refetch()}
            className="min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100"
          >
            Reintentar
          </button>
        </div>
      )}
      {radar.data && (
        <>
          <RadarSummary summary={radar.data.summary} />
          <Link to="/radar" className="min-h-11 self-start py-2 text-sm font-medium underline">
            Ver el Radar completo
          </Link>
        </>
      )}
    </section>
  );
}
