import { Link } from 'react-router';
import { buttonStyles } from '../../components/ui/buttonStyles';
import { Card } from '../../components/ui/Card';

const cta = buttonStyles({ variant: 'primary' });

/** The period exists but has no subjects yet: the single next step is to add one. */
export function NoSubjects() {
  return (
    <Card as="section" variant="dashed" className="p-6 text-center">
      <h2 className="mb-1 text-section-title">Aún no tienes asignaturas.</h2>
      <p className="mb-4 text-muted-foreground">
        Agrega las materias de este semestre para empezar a registrar tus actividades.
      </p>
      <Link to="/subjects?action=create" className={cta}>
        Agregar asignatura
      </Link>
    </Card>
  );
}

/** Subjects exist but nothing is registered yet: a useful screen instead of a wall of zeros. */
export function NoActivities() {
  return (
    <Card as="section" variant="dashed" className="p-6 text-center">
      <h2 className="mb-1 text-section-title">Todavía no tienes actividades registradas.</h2>
      <p className="mb-4 text-muted-foreground">
        Agrega tareas, parciales y entregas para ver aquí lo que viene y cómo vas.
      </p>
      <Link to="/activities?action=create" className={cta}>
        Agregar actividad
      </Link>
    </Card>
  );
}
