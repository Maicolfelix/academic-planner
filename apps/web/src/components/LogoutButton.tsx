import { useNavigate } from 'react-router';
import { useLogout } from '../auth/useAuth';

export function LogoutButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <>
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
        className={`min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60 ${className}`}
      >
        {logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
      {logout.isError && (
        <p role="alert" className="order-4 w-full text-sm text-red-700">
          No se pudo cerrar la sesión: {logout.error.message}
        </p>
      )}
    </>
  );
}
