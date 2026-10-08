import { Link } from 'react-router';
import { buttonStyles } from '../../components/ui/buttonStyles';
import { EmptyState } from '../../components/ui/EmptyState';

const cta = buttonStyles({ variant: 'primary' });

/** The period exists but has no subjects yet: the single next step is to add one. */
export function NoSubjects() {
  return (
    <EmptyState
      titleAs="h2"
      title="Aún no tienes asignaturas."
      action={
        <Link to="/subjects?action=create" className={cta}>
          Agregar asignatura
        </Link>
      }
    >
      Agrega las materias de este semestre para empezar a registrar tus actividades.
    </EmptyState>
  );
}

/** Subjects exist but nothing is registered yet: a useful screen instead of a wall of zeros. */
export function NoActivities() {
  return (
    <EmptyState
      titleAs="h2"
      title="Todavía no tienes actividades registradas."
      action={
        <Link to="/activities?action=create" className={cta}>
          Agregar actividad
        </Link>
      }
    >
      Agrega tareas, parciales y entregas para ver aquí lo que viene y cómo vas.
    </EmptyState>
  );
}
