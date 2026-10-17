import { useState } from 'react';
import { Link } from 'react-router';
import { FormField } from '../components/FormField';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CheckIcon } from '../components/ui/icons';
import { askClass, Heading } from './CaptureCard';
import { gradeResolution, gradeView, type ReviewGrade } from './reviewModel';

export interface GradeActions {
  setSubject: (optionIndex: number) => void;
  setTarget: (choiceIndex: number) => void;
  setBasis: (basis: 'GRADING_PERIOD' | 'FINAL') => void;
  setCanonical: (milli: number | null) => void;
  toggle: (selected: boolean) => void;
  remove: () => void;
}

interface Props {
  grade: ReviewGrade;
  actions: GradeActions;
  level: 3 | 4;
  disabled?: boolean;
}

const NOTICES: Record<string, (cut: string | null) => string> = {
  CUT_BROKEN_DOWN: (cut) =>
    `${cut ?? 'Ese corte'} está desglosado en evaluaciones: la nota va en una de ellas.`,
  CUT_HAS_DIRECT: (cut) =>
    `${cut ?? 'Ese corte'} ya tiene una nota directa. Para agregar una evaluación, desglósalo desde la pantalla de notas.`,
  NO_PENDING_EVALUATIONS: () =>
    '¿A cuál evaluación corresponde? No encontré una pendiente con ese nombre.',
  NO_MATCHING_CUT: () => 'No encontré ese corte en la materia.',
};

/**
 * A grade the app understood, in plain words ("Farmacología · Corte 2 · Nota: 4.3"). It asks only what is missing: the subject,
 * the cut or evaluation, what the percentage is of, the grade on the scale of the subject. Never an internal term.
 */
export function GradeCard({ grade, actions, level, disabled }: Props) {
  const id = `capture-${grade.suggestion.clientId}`;
  const r = gradeResolution(grade);
  const v = gradeView(grade);
  const s = grade.suggestion;
  const complete = r.request !== null;
  const option = r.option;
  const [typed, setTyped] = useState('');

  const optionLabel = (o: (typeof s.options)[number]) =>
    o.subject.studyName ? `${o.subject.name} · ${o.subject.studyName}` : o.subject.name;

  return (
    <li>
      <Card
        as="article"
        aria-labelledby={`${id}-title`}
        className={`flex flex-col gap-3 p-4 ${disabled ? 'opacity-60' : ''}`}
      >
        <header className="flex items-start gap-2">
          <label className="-m-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center p-2">
            <input
              type="checkbox"
              checked={grade.selected}
              onChange={(e) => actions.toggle(e.target.checked)}
              disabled={disabled}
              aria-label={`Incluir ${v.title} de ${v.subject}`}
              className="size-5 accent-[var(--accent)]"
            />
          </label>
          <div className="min-w-0 flex-1">
            <Heading
              level={level}
              id={`${id}-title`}
              className="text-base font-semibold break-words"
            >
              {v.subject}
            </Heading>
            <p className="text-sm break-words text-muted-foreground">
              {[v.cut, v.title !== 'Nota del corte' ? v.title : null, v.weight, v.score]
                .filter(Boolean)
                .join(' · ') || 'Nota por completar'}
            </p>
            {complete && <p className="text-sm text-muted-foreground">{v.action}</p>}
          </div>
          {complete ? (
            <Badge tone="success">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              Lista
            </Badge>
          ) : (
            <Badge tone="warning">Falta algo</Badge>
          )}
        </header>

        {grade.error && (
          <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger-ink">
            {grade.error}
          </p>
        )}

        {r.missing.includes('SUBJECT') && (
          <div className={askClass} role="group" aria-label="Asignatura por decidir">
            <p className="font-medium">¿A cuál asignatura te refieres?</p>
            <div className="flex flex-wrap gap-2">
              {s.options.map((o, i) => (
                <Button key={o.subject.id} size="sm" onClick={() => actions.setSubject(i)}>
                  {optionLabel(o)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {r.missing.includes('CONFIG') && option && (
          <div className={askClass} role="group" aria-label="Notas sin configurar">
            <p className="font-medium">Esta materia todavía no tiene configuradas sus notas.</p>
            <p className="text-muted-foreground">
              Lo que escribiste queda aquí mientras las configuras.
            </p>
            <div>
              <Link
                to={`/subjects/${option.subject.id}/grades`}
                className="inline-flex min-h-11 items-center font-medium text-accent-ink underline"
              >
                Configurar notas
              </Link>
            </div>
          </div>
        )}

        {r.missing.includes('TARGET') && option && (
          <div className={askClass} role="group" aria-label="Destino de la nota">
            <p className="font-medium">
              {option.notice
                ? NOTICES[option.notice]!(option.noticeCut)
                : s.intent === 'NEW_EVALUATION'
                  ? '¿En cuál corte va?'
                  : '¿A cuál corresponde?'}
            </p>
            <div className="flex flex-wrap gap-2">
              {option.choices.map((c, i) => (
                <Button key={i} size="sm" onClick={() => actions.setTarget(i)}>
                  {c.action === 'SCORE_EVALUATION'
                    ? `${c.evaluation.name} · ${c.evaluation.cutName}`
                    : c.cut.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {r.missing.includes('BASIS') && (
          <div className={askClass} role="group" aria-label="Porcentaje por decidir">
            <p className="font-medium">
              ¿El {s.weight.percentBp === null ? 'porcentaje' : `${s.weight.percentBp / 100} %`}{' '}
              corresponde al corte o a la nota final?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => actions.setBasis('GRADING_PERIOD')}>
                Al corte
              </Button>
              <Button size="sm" onClick={() => actions.setBasis('FINAL')}>
                A la nota final
              </Button>
            </div>
          </div>
        )}

        {r.missing.includes('WEIGHT') && (
          <p className={askClass}>
            {r.weightProblem === 'NOT_EXACT'
              ? 'Ese porcentaje de la nota final no equivale a un porcentaje exacto del corte. Agrégala desde la pantalla de notas de la materia.'
              : 'Falta el porcentaje de esta evaluación. Agrégala desde la pantalla de notas de la materia.'}
          </p>
        )}

        {r.missing.includes('CANONICAL') && option?.profile && (
          <div className={askClass}>
            <p className="font-medium">
              {option.scoreProblem === 'OUT_OF_RANGE'
                ? 'Esa nota queda fuera de la escala de la materia.'
                : 'Esta escala no empieza en 0: ¿cuál es la nota en la escala de la materia?'}
            </p>
            <FormField
              id={`${id}-canonical`}
              label={`Nota (de ${option.profile.minMilli / 1000} a ${option.profile.maxMilli / 1000})`}
              value={typed}
              inputMode="decimal"
              onChange={(value) => {
                setTyped(value);
                const n = Number(value.replace(',', '.'));
                actions.setCanonical(
                  value.trim() !== '' && Number.isFinite(n) ? Math.round(n * 1000) : null,
                );
              }}
            />
          </div>
        )}

        <div>
          <Button size="sm" variant="ghost" onClick={actions.remove} disabled={disabled}>
            Descartar
          </Button>
        </div>
      </Card>
    </li>
  );
}
