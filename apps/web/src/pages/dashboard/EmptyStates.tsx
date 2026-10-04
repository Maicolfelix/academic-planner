import { Link } from 'react-router';

const cta =
  'inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** The period exists but has no subjects yet: the single next step is to add one. */
export function NoSubjects() {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
      <h2 className="mb-1 text-lg font-semibold">Aún no tienes asignaturas.</h2>
      <p className="mb-4 text-slate-600">
        Agrega las materias de este semestre para empezar a registrar tus actividades.
      </p>
      <Link to="/subjects?action=create" className={cta}>
        Agregar asignatura
      </Link>
    </section>
  );
}

/** Subjects exist but nothing is registered yet: a useful screen instead of a wall of zeros. */
export function NoActivities() {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
      <h2 className="mb-1 text-lg font-semibold">Todavía no tienes actividades registradas.</h2>
      <p className="mb-4 text-slate-600">
        Agrega tareas, parciales y entregas para ver aquí lo que viene y cómo vas.
      </p>
      <Link to="/activities?action=create" className={cta}>
        Agregar actividad
      </Link>
    </section>
  );
}
