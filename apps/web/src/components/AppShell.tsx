import { NavLink, Outlet, useLocation } from 'react-router';
import { useDueReminders } from '../reminders/useReminders';
import { LogoutButton } from './LogoutButton';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-100 ${
    isActive ? 'bg-slate-100 text-slate-950 underline underline-offset-4' : 'text-slate-700'
  }`;

/** Navigation for authenticated screens. Wraps on narrow phones instead of overflowing. */
export function AppShell() {
  // The weekly grid needs seven readable columns; every other screen is a comfortable reading column.
  const wide = useLocation().pathname.startsWith('/calendar');
  const width = wide ? 'max-w-6xl' : 'max-w-3xl';
  const dueCount = useDueReminders().data?.total ?? 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <nav
          aria-label="Principal"
          className={`mx-auto flex ${width} flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2`}
        >
          <span className="mr-auto py-2 font-semibold">Academic Planner</span>
          <NavLink to="/dashboard" className={linkClass}>
            Inicio
            {dueCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 text-xs">
                <span aria-hidden="true">🔔 {dueCount}</span>
                <span className="sr-only">
                  {' '}
                  {dueCount} {dueCount === 1 ? 'recordatorio' : 'recordatorios'}
                </span>
              </span>
            )}
          </NavLink>
          <NavLink to="/subjects" className={linkClass}>
            Asignaturas
          </NavLink>
          <NavLink to="/activities" className={linkClass}>
            Actividades
          </NavLink>
          <NavLink to="/calendar" className={linkClass}>
            Agenda
          </NavLink>
          <LogoutButton />
        </nav>
      </header>
      <main className={`mx-auto ${width} px-4 py-6`}>
        <Outlet />
      </main>
    </div>
  );
}
