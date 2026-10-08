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

// Phone and tablet: icon over label; a bar that SLIDES along the top edge (see the indicator below) and a soft capsule that
// lifts behind the icon mark the current place. Desktop (lg): icon beside label on a soft fill. The current place is
// never color alone: `aria-current="page"` (set by NavLink), a heavier label, and the bar or underline.
const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-xs',
    'transition-[color,background-color] duration-(--duration-fast) ease-standard',
    'active:bg-secondary lg:min-h-11 lg:flex-row lg:gap-2 lg:px-2.5 lg:text-sm',
    isActive
      ? 'font-semibold text-primary lg:bg-secondary lg:underline lg:underline-offset-4'
      : 'font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
  ].join(' ');

/** The capsule behind a phone icon: invisible at rest, a soft accent pill that lifts a little when it is the current place. */
const capsule = (isActive: boolean) =>
  `grid place-items-center rounded-full px-4 py-0.5 transition-[background-color,transform] duration-(--duration-normal) ease-spring lg:p-0 ${
    isActive
      ? '-translate-y-0.5 bg-accent-soft text-accent-ink lg:translate-y-0 lg:bg-transparent'
      : 'bg-transparent'
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
  // Same rule NavLink uses to mark the current place (a path that starts with the destination), so the indicator and
  // `aria-current` always agree. -1 on screens that are not one of the four (Radar, Bandeja…): the indicator hides.
  const active = MAIN_NAV.findIndex(({ to }) => pathname === to || pathname.startsWith(`${to}/`));

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
            <div className="relative mx-auto grid max-w-md grid-cols-4 lg:flex lg:max-w-none lg:gap-1">
              {/* The sliding mark of the current place (phone and tablet only). Decoration: the real signal is aria-current. */}
              <span
                aria-hidden="true"
                data-nav-indicator={active}
                className="pointer-events-none absolute inset-y-0 left-0 w-1/4 transition-[transform,opacity] duration-(--duration-normal) ease-enter lg:hidden"
                style={{
                  transform: `translateX(${Math.max(active, 0) * 100}%)`,
                  opacity: active < 0 ? 0 : 1,
                }}
              >
                <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent" />
              </span>
              {MAIN_NAV.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} className={linkClass}>
                  {({ isActive }) => (
                    <>
                      <span className={capsule(isActive)}>
                        <Icon />
                      </span>
                      {label}
                      {to === '/dashboard' && dueCount > 0 && (
                        <span className="absolute top-1.5 left-1/2 ml-3 rounded-full border border-warning-line bg-warning-soft px-1.5 text-xs text-warning-ink lg:static lg:ml-0">
                          <span aria-hidden="true">🔔 {dueCount}</span>
                          <span className="sr-only">
                            {' '}
                            {dueCount} {dueCount === 1 ? 'recordatorio' : 'recordatorios'}
                          </span>
                        </span>
                      )}
                    </>
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
