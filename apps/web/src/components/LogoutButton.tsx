import { useNavigate } from 'react-router';
import { useLogout } from '../auth/useAuth';
import { Button } from './ui/Button';
import { LogoutIcon } from './ui/icons';

export function LogoutButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <>
      <Button
        variant="ghost"
        title="Cerrar sesión"
        size="sm"
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
        className={`gap-2 border border-border-strong/50 bg-surface font-semibold hover:text-danger-ink ${className}`}
      >
        <LogoutIcon className="size-5" />
        <span className="sr-only sm:not-sr-only lg:sr-only xl:not-sr-only">
          {logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}
        </span>
      </Button>
      {logout.isError && (
        <p role="alert" className="order-4 w-full text-sm text-red-700">
          No se pudo cerrar la sesión: {logout.error.message}
        </p>
      )}
    </>
  );
}
