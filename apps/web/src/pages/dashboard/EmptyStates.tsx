import { Link } from 'react-router';
import { buttonStyles } from '../../components/ui/buttonStyles';
import { EmptyState } from '../../components/ui/EmptyState';

const primary = buttonStyles({ variant: 'primary' });
const secondary = buttonStyles({ variant: 'secondary' });
const quiet = buttonStyles({ variant: 'ghost', size: 'sm' });

/** At most three ways in: the two that save typing first, the manual one quietly last. */
function Ways({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>;
}

/**
 * The period exists but has no subjects yet. Starting from what the student already has comes first (their timetable, or
 * a few lines of what is pending); adding a subject by hand is the quiet third way. Only routes that already exist.
 */
export function NoSubjects() {
  return (
    <EmptyState
      art="calendar"
      titleAs="h2"
      title="Empieza con lo que ya tienes."
      action={
        <Ways>
          <Link to="/calendar/import" className={primary}>
            Importar mi horario
          </Link>
          <Link to="/inbox" className={secondary}>
            Interpretar un mensaje
          </Link>
          <Link to="/subjects?action=create" className={quiet}>
            Añadir asignatura manualmente
          </Link>
        </Ways>
      }
    >
      Trae tu horario o escribe lo que tienes pendiente: lo organizamos y tú confirmas.
    </EmptyState>
  );
}

/** Subjects exist but nothing is registered yet: capture (right here on the Home), a calendar, or one by hand. */
export function NoActivities() {
  return (
    <EmptyState
      art="inbox"
      titleAs="h2"
      title="Registra lo que tienes pendiente."
      action={
        <Ways>
          <button
            type="button"
            className={primary}
            onClick={() => {
              const box = document.getElementById('capture-text-QUICK');
              box?.scrollIntoView({ block: 'center' });
              box?.focus();
            }}
          >
            Captura rápida
          </button>
          <Link to="/calendar/import-ics" className={secondary}>
            Importar calendario .ics
          </Link>
          <Link to="/activities?action=create" className={quiet}>
            Añadir actividad manualmente
          </Link>
        </Ways>
      }
    >
      Escribe tus pendientes con tus propias palabras o importa un calendario: tú revisas y
      confirmas.
    </EmptyState>
  );
}
