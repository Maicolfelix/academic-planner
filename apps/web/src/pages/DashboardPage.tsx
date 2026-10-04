import { formatDateOnly } from '@planner/core';
import { Link } from 'react-router';
import { useCurrentPeriod } from '../academic/useAcademic';
import { useMe } from '../auth/useAuth';

/** Temporary home. The real Dashboard (activities, radar, progress) arrives in Phase 5. */
export function DashboardPage() {
  const { data: user } = useMe();
  const { period } = useCurrentPeriod();

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold break-words">Hola, {user?.name}</h1>
      <p>Tu sesión está activa.</p>
      {period && (
        <p className="text-slate-700">
          Periodo actual: <strong>{period.name}</strong> ({formatDateOnly(period.startDate)} –{' '}
          {formatDateOnly(period.endDate)})
        </p>
      )}
      <p>
        <Link to="/subjects" className="font-medium underline">
          Ver mis asignaturas
        </Link>
      </p>
    </div>
  );
}
