import { QueryError } from '../../components/QueryError';
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
      <QueryError query={radar} title="No se pudo cargar el Radar" />
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
