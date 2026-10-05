import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useDueReminders } from '../reminders/useReminders';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LogoutButton } from './LogoutButton';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center justify-center rounded-md px-1 py-2 text-center text-[0.8125rem] font-medium hover:bg-slate-100 md:px-3 md:text-sm ${
    isActive ? 'bg-slate-100 text-slate-950 underline underline-offset-4' : 'text-slate-700'
  }`;

const TITLES: [prefix: string, title: string][] = [
  ['/dashboard', 'Inicio'],
  ['/subjects', 'Asignaturas'],
  ['/activities', 'Actividades'],
  ['/calendar/import', 'Importar horario'],
  ['/calendar', 'Agenda'],
  ['/radar', 'Radar académico'],
  ['/progress', 'Progreso'],
  ['/inbox', 'Bandeja académica'],
];

/** Navigation for authenticated screens. Wraps on narrow phones instead of overflowing. */
export function AppShell() {
  const { pathname } = useLocation();
  // The weekly grid needs seven readable columns; every other screen is a comfortable reading column.
  const wide = pathname === '/calendar';
  const width = wide ? 'max-w-6xl' : 'max-w-3xl';
  const dueCount = useDueReminders().data?.total ?? 0;
  useDocumentTitle(TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1]);

  return (
    <div className="min-h-screen">
      {/* First stop of the keyboard: jump over the navigation, straight to the page. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-3 focus:text-white focus:outline-2 focus:outline-offset-2 focus:outline-white"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-slate-200">
        <nav
          aria-label="Principal"
          className={`mx-auto flex ${width} flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2`}
        >
          <span className="order-1 mr-auto py-2 font-semibold">Academic Planner</span>
          {/* Phone: brand + sign-out on the first row, the four sections on a second, evenly spaced row. */}
          <LogoutButton className="order-2 md:order-3" />
          <div className="order-3 grid w-full grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))] gap-1 md:order-2 md:flex md:w-auto md:gap-2">
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
          </div>
        </nav>
      </header>
      <main id="contenido" tabIndex={-1} className={`mx-auto ${width} px-4 py-6 outline-none`}>
        <Suspense fallback={<p role="status">Cargando…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
