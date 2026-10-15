import { formatDateOnly } from '@planner/core';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { buttonStyles } from '../../components/ui/buttonStyles';
import { ActionMenu, type ActionMenuItem } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PencilIcon } from '../../components/ui/icons';
import {
  levelLabel,
  subjectsCountLabel,
  typeLabel,
  type StudyCardModel,
} from '../../studies/studyModel';

/**
 * One active study: its name, its kind, whether it is the main one, its current period (and level) and how many subjects that
 * period has. One visible way forward ("Ver materias", or "Elegir periodo" when it has no current period) and the rest behind
 * "Más acciones". Long names wrap; nothing is color alone ("Principal" is a word).
 */
export function StudyCard({
  card,
  canOpenSubjects,
  onEdit,
  onPeriods,
  onPrimary,
  onArchive,
}: {
  card: StudyCardModel;
  /** There is a HOME period, so the subjects screen can open (without one the app asks for a period first). */
  canOpenSubjects: boolean;
  onEdit: () => void;
  onPeriods: () => void;
  onPrimary: () => void;
  onArchive: () => void;
}) {
  const { track, current, subjectCount } = card;
  const level = current ? levelLabel(track.type, current) : null;
  const items: ActionMenuItem[] = [
    { label: 'Editar', ariaLabel: `Editar ${track.name}`, icon: <PencilIcon />, onSelect: onEdit },
    { label: 'Periodos', ariaLabel: `Periodos de ${track.name}`, onSelect: onPeriods },
    ...(track.isPrimary
      ? []
      : [
          {
            label: 'Hacer principal',
            ariaLabel: `Hacer principal ${track.name}`,
            onSelect: onPrimary,
          },
        ]),
    { label: 'Archivar', ariaLabel: `Archivar ${track.name}`, onSelect: onArchive, danger: true },
  ];

  return (
    <Card as="li" className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold break-words">{track.name}</h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{typeLabel(track.type)}</span>
            {track.isPrimary && <Badge tone="info">Principal</Badge>}
          </p>
        </div>
        <ActionMenu label={`Más acciones: ${track.name}`} items={items} />
      </div>

      {current ? (
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="break-words">
            <span className="text-muted-foreground">Periodo actual: </span>
            <span className="font-medium">{current.name}</span>
            {level && <span> · {level}</span>}
          </p>
          <p className="text-muted-foreground">
            {formatDateOnly(current.startDate)} – {formatDateOnly(current.endDate)} ·{' '}
            {subjectsCountLabel(subjectCount)}
          </p>
        </div>
      ) : (
        <p className="text-sm">
          <span className="font-medium">Sin periodo actual.</span>{' '}
          <span className="text-muted-foreground">
            Elige o crea uno para que aparezca en tus resúmenes.
          </span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {current && canOpenSubjects ? (
          <Link
            to={`/subjects?period=${current.id}`}
            aria-label={`Ver materias de ${track.name}`}
            className={buttonStyles({ size: 'sm' })}
          >
            Ver materias
          </Link>
        ) : null}
        {!current && (
          <Button size="sm" variant="primary" onClick={onPeriods}>
            Elegir o crear periodo
          </Button>
        )}
      </div>
    </Card>
  );
}
