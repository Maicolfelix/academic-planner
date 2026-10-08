import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useDueReminders } from '../reminders/useReminders';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LogoutButton } from './LogoutButton';
import { BookIcon, BrandMark, CalendarIcon, CheckSquareIcon, HomeIcon } from './ui/icons';

/**
 * The four places a student comes back to every day. Everything else is reached from the screen where it makes
 * sense (Radar and Progreso from Inicio, Bandeja from Inicio, Importar horario from Agenda): a longer bar would
 * only make the four that matter harder to find.
 */
export const MAIN_NAV = [
  { to: '/dashboard', label: 'Inicio', Icon: HomeIcon },
  { to: '/activities', label: 'Actividades', Icon: CheckSquareIcon },
  { to: '/calendar', label: 'Agenda', Icon: CalendarIcon },
  { to: '/subjects', label: 'Asignaturas', Icon: BookIcon },
] as const;

// Phone and tablet: icon over label, a bar along the top edge marks the current place. Desktop (lg): icon beside label on a soft
// fill. The current place is never color alone: `aria-current="page"` (set by NavLink), a heavier label and the bar
// or underline.
const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-xs',
    'transition-[color,background-color] duration-(--duration-fast) ease-standard',
    'active:bg-secondary lg:min-h-11 lg:flex-row lg:gap-2 lg:px-2.5 lg:text-sm',
    isActive
      ? 'font-semibold text-primary before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-accent lg:bg-secondary lg:underline lg:underline-offset-4 lg:before:hidden'
      : 'font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
  ].join(' ');

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

/**
 * The frame of every signed-in screen: a top bar with the brand and "Cerrar sesión", and ONE main navigation that is
 * a bar fixed to the bottom on a phone (thumb reach, like a native app) and sits in the top bar from `lg` (1024 px) up. It is a
 * single `<nav>` so there is no duplicate landmark; only CSS moves it.
 */
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
      <header className="border-b border-border bg-surface">
        {/* The bar is as wide as the widest screen (Agenda), so brand, four destinations and sign-out fit on ONE row from 1024 px; the reading column below it stays narrow. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 px-4 py-2">
          <span className="mr-auto flex items-center gap-2 py-2 font-semibold tracking-tight lg:mr-0">
            <BrandMark />
            Academic Planner
          </span>

          <nav
            aria-label="Principal"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-14px_rgb(20_26_60/0.25)] lg:static lg:mr-auto lg:ml-4 lg:border-t-0 lg:bg-transparent lg:pb-0 lg:shadow-none"
          >
            {/* Plain links, not a list: the screens count their own list items (cards) and a navigation is a landmark. */}
            <div className="mx-auto grid max-w-md grid-cols-4 lg:flex lg:max-w-none lg:gap-1">
              {MAIN_NAV.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} className={linkClass}>
                  <Icon />
                  {label}
                  {to === '/dashboard' && dueCount > 0 && (
                    <span className="absolute top-1.5 left-1/2 ml-2 rounded-full border border-warning-line bg-warning-soft px-1.5 text-xs text-warning-ink lg:static lg:ml-0">
                      <span aria-hidden="true">🔔 {dueCount}</span>
                      <span className="sr-only">
                        {' '}
                        {dueCount} {dueCount === 1 ? 'recordatorio' : 'recordatorios'}
                      </span>
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>

          {/* The end of the bar is where the avatar and the bell will go: they arrive with their own features. */}
          <LogoutButton />
        </div>
      </header>
      <main
        id="contenido"
        tabIndex={-1}
        className={`mx-auto ${width} px-4 pt-6 pb-24 outline-none lg:pb-6`}
      >
        <Suspense fallback={<p role="status">Cargando…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
