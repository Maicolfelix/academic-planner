import { NavLink, Outlet } from 'react-router';
import { LogoutButton } from './LogoutButton';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-100 ${
    isActive ? 'bg-slate-100 text-slate-950 underline underline-offset-4' : 'text-slate-700'
  }`;

/** Navigation for authenticated screens. Wraps on narrow phones instead of overflowing. */
export function AppShell() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <nav
          aria-label="Principal"
          className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2"
        >
          <span className="mr-auto py-2 font-semibold">Academic Planner</span>
          <NavLink to="/dashboard" className={linkClass}>
            Inicio
          </NavLink>
          <NavLink to="/subjects" className={linkClass}>
            Asignaturas
          </NavLink>
          <LogoutButton />
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
