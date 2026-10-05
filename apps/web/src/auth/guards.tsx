import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { usePeriods } from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { OFFLINE_DETAIL, OFFLINE_MESSAGE } from '../pwa/pwaState';
import {
  clearSessionExpired,
  SESSION_EXPIRED_MESSAGE,
  sessionExpiredPending,
} from './sessionExpiry';
import { useMe } from './useAuth';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="text-center">{children}</div>
    </main>
  );
}

/** The API is unreachable (offline or down): say so plainly instead of a raw error. */
const isUnreachable = (error: Error) => error instanceof ApiRequestError && error.status === 0;

function RetryMessage({
  text,
  error,
  onRetry,
}: {
  text: string;
  error: Error;
  onRetry: () => void;
}) {
  const unreachable = isUnreachable(error);
  return (
    <FullPageMessage>
      <p role="alert" className="mb-3 text-red-700">
        {unreachable ? OFFLINE_MESSAGE : text}
      </p>
      {unreachable && <p className="mb-3 text-sm text-slate-700">{OFFLINE_DETAIL}</p>}
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

/** To the login; when the server ended the session, the login says so. */
function RedirectToLogin() {
  const [expired] = useState(sessionExpiredPending);
  useEffect(() => clearSessionExpired(), []);
  return (
    <Navigate
      to="/login"
      replace
      state={expired ? { warning: SESSION_EXPIRED_MESSAGE } : undefined}
    />
  );
}

/** Renders child routes only for a signed-in user; otherwise sends them to /login. */
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <FullPageMessage>Verificando sesión…</FullPageMessage>;
  // A failed background refetch (e.g. the connection dropped) keeps the data already loaded on screen.
  if (me.isError && !me.data) {
    return (
      <RetryMessage
        text={`No se pudo verificar tu sesión: ${me.error.message}`}
        error={me.error}
        onRetry={() => me.refetch()}
      />
    );
  }
  return me.data ? <Outlet /> : <RedirectToLogin />;
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
  if (periods.isError && !periods.data) {
    return (
      <RetryMessage
        text={`No se pudo cargar tu periodo académico: ${periods.error.message}`}
        error={periods.error}
        onRetry={() => periods.refetch()}
      />
    );
  }
  return periods.data.some((p) => p.isCurrent) ? <Outlet /> : <Navigate to="/onboarding" replace />;
}
