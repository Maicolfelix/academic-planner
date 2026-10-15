import { useSubjects } from '../../academic/useAcademic';
import { QueryError } from '../../components/QueryError';
import { ActivityFormDialog } from './ActivityFormDialog';

type Props = Parameters<typeof ActivityFormDialog>[0];

/**
 * The dialog the pages open. A NEW activity keeps using the subjects it is given (the HOME period's: creating is not
 * multi-destination). EDITING one uses the subjects of the activity's OWN period, whichever period is the home one: an activity
 * never changes period and a subject must belong to it, so offering the home subjects there would be wrong.
 */
export function ActivityDialog(props: Props) {
  const own = useSubjects(props.activity?.periodId);
  if (!props.activity) return <ActivityFormDialog {...props} />;
  if (own.isError) return <QueryError query={own} title="No se pudieron cargar las asignaturas" />;
  if (!own.isSuccess) return null;
  return <ActivityFormDialog {...props} subjects={own.data} />;
}
