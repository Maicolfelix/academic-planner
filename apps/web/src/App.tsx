import { useQuery } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { fetchHealth } from './api/client';

function StatusPage() {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Planificador Académico</h1>
      <section aria-live="polite" className="rounded-lg border border-slate-300 p-4">
        <h2 className="text-sm font-medium text-slate-600">Estado del sistema</h2>
        {isPending && <p>Conectando con el servidor…</p>}
        {error && (
          <p role="alert" className="text-red-700">
            No se pudo conectar con el servidor: {error.message}
          </p>
        )}
        {data && (
          <dl className="mt-2 grid grid-cols-2 gap-1" data-testid="health">
            <dt>API</dt>
            <dd>{data.status === 'ok' ? 'Operativa' : 'Degradada'}</dd>
            <dt>Base de datos</dt>
            <dd>{data.database === 'up' ? 'Conectada' : 'Sin conexión'}</dd>
          </dl>
        )}
      </section>
      <button
        type="button"
        onClick={() => refetch()}
        className="self-start rounded-md bg-slate-900 px-4 py-2 text-white"
      >
        Reintentar
      </button>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<StatusPage />} />
    </Routes>
  );
}
