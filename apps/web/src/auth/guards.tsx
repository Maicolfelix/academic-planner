import { Navigate, Outlet } from 'react-router';
import { useMe } from './useAuth';

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="text-center">{children}</div>
    </main>
  );
}

/** Renders child routes only for a signed-in user; otherwise sends them to /login. */
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <FullPageMessage>Verificando sesión…</FullPageMessage>;
  if (me.isError) {
    return (
      <FullPageMessage>
        <p role="alert" className="mb-3 text-red-700">
          No se pudo verificar tu sesión: {me.error.message}
        </p>
        <button
          type="button"
          onClick={() => me.refetch()}
          className="rounded-md bg-slate-900 px-4 py-2 text-white"
        >
          Reintentar
        </button>
      </FullPageMessage>
    );
  }
  return me.data ? <Outlet /> : <Navigate to="/login" replace />;
}

/** Login/register are for signed-out users; signed-in users go straight to the app. */
export function PublicOnly() {
  const me = useMe();

  if (me.isPending) return <FullPageMessage>Cargando…</FullPageMessage>;
  // If the session check failed (server down) still show the form: submitting will report the error.
  return me.data ? <Navigate to="/dashboard" replace /> : <Outlet />;
}
