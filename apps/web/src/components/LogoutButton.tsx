import { useNavigate } from 'react-router';
import { useLogout } from '../auth/useAuth';
import { Button } from './ui/Button';

export function LogoutButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <>
      <Button
        variant="ghost"
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
        className={className}
      >
        {logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}
      </Button>
      {logout.isError && (
        <p role="alert" className="order-4 w-full text-sm text-red-700">
          No se pudo cerrar la sesión: {logout.error.message}
        </p>
      )}
    </>
  );
}
