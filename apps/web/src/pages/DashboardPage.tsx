import { useNavigate } from 'react-router';
import { useLogout, useMe } from '../auth/useAuth';

/** Temporary protected screen that only proves authentication works. The real Dashboard is Phase 5. */
export function DashboardPage() {
  const navigate = useNavigate();
  const { data: user } = useMe();
  const logout = useLogout();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Hola, {user?.name}</h1>
      <p>Tu sesión está activa.</p>
      {logout.isError && (
        <p role="alert" className="text-sm text-red-700">
          No se pudo cerrar la sesión: {logout.error.message}
        </p>
      )}
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: () =>
              navigate('/login', {
                replace: true,
                state: { notice: 'Sesión cerrada correctamente.' },
              }),
          })
        }
        className="self-start rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
    </main>
  );
}
