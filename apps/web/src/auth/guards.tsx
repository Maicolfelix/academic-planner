import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { usePeriods } from '../academic/useAcademic';
import { useMe } from './useAuth';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="text-center">{children}</div>
    </main>
  );
}

function RetryMessage({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <FullPageMessage>
      <p role="alert" className="mb-3 text-red-700">
        {text}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-slate-900 px-4 py-2 text-white"
      >
        Reintentar
      </button>
    </FullPageMessage>
  );
}

/** Renders child routes only for a signed-in user; otherwise sends them to /login. */
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <FullPageMessage>Verificando sesión…</FullPageMessage>;
  if (me.isError) {
    return (
      <RetryMessage
        text={`No se pudo verificar tu sesión: ${me.error.message}`}
        onRetry={() => me.refetch()}
      />
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

/** The app needs a current academic period; a user without one is sent to onboarding first. */
export function RequirePeriod() {
  const periods = usePeriods();

  if (periods.isPending) return <FullPageMessage>Cargando tu periodo académico…</FullPageMessage>;
  if (periods.isError) {
    return (
      <RetryMessage
        text={`No se pudo cargar tu periodo académico: ${periods.error.message}`}
        onRetry={() => periods.refetch()}
      />
    );
  }
  return periods.data.some((p) => p.isCurrent) ? <Outlet /> : <Navigate to="/onboarding" replace />;
}
