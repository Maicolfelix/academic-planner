import { type Subject } from '@planner/core';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CaptureCard, Heading, SubjectQuestion, TimeAsk, type CardActions } from './CaptureCard';
import { clockLabel, shortDate } from './format';
import {
  chooseGroupSubject,
  chooseGroupTime,
  effectiveDate,
  effectiveTitle,
  remove,
  setDate,
  setSubject,
  setTime,
  setTitle,
  setType,
  summarize,
  toggle,
  type ReviewState,
} from './reviewModel';

interface Props {
  state: ReviewState;
  onChange: (next: ReviewState) => void;
  subjects: readonly Subject[];
  pending: boolean;
  /** The server refused the whole confirmation with this message (nothing was created). */
  error?: string;
  onConfirm: () => void;
  onBack: () => void;
  onDiscard: () => void;
  /** "Crear de todos modos": the server found exact copies and the student wants them anyway. */
  onConfirmAnyway?: () => void;
  /** The heading level of the review: 2 on a page of its own, 3 inside a section. Its cards are one below. */
  level: 2 | 3;
}

/**
 * THE review, shared by Quick Capture and the Inbox. A proposal that needs nothing only says what it will create; what is
 * in doubt is asked on the card that has it, and a doubt several cards share is asked ONCE, above them. One button creates
 * everything that is ticked and complete.
 */
export function CaptureReview({
  state,
  onChange,
  subjects,
  pending,
  error,
  onConfirm,
  onBack,
  onDiscard,
  onConfirmAnyway,
  level,
}: Props) {
  const summary = summarize(state);

  const actionsFor = (clientId: string): CardActions => ({
    setTitle: (v) => onChange(setTitle(state, clientId, v)),
    setType: (v) => onChange(setType(state, clientId, v)),
    setDate: (v) => onChange(setDate(state, clientId, v)),
    setTime: (v) => onChange(setTime(state, clientId, v)),
    setSubject: (v) => onChange(setSubject(state, clientId, v)),
    toggle: (v) => onChange(toggle(state, clientId, v)),
    remove: () => onChange(remove(state, clientId)),
  });

  // Shared questions still open: the hour of a group, the subject of a group.
  const stillOpen = (c: ReviewState['corrections'][number]) =>
    state.items.filter(
      (i) =>
        c.clientIds.includes(i.proposal.clientId) &&
        (c.field === 'time' ? i.time === undefined : i.subject === undefined),
    ).length >= 1 &&
    c.clientIds.filter((id) => state.items.some((i) => i.proposal.clientId === id)).length >= 2;
  const openTime = state.corrections.filter(
    (c) => c.field === 'time' && state.groupTime[c.key] === undefined && stillOpen(c),
  );
  const openSubject = state.corrections.filter(
    (c) => c.field === 'subject' && state.groupSubject[c.key] === undefined && stillOpen(c),
  );

  const itemsOf = (ids: readonly string[]) =>
    state.items.filter((i) => ids.includes(i.proposal.clientId));
  const describe = (ids: readonly string[]) =>
    itemsOf(ids)
      .map((i) => `${effectiveTitle(i)} (${shortDate(effectiveDate(i))})`)
      .join(', ');

  const count = summary.toCreate;
  const label = `Crear ${count} ${count === 1 ? 'actividad' : 'actividades'}`;
  const waiting = summary.incomplete;

  return (
    <section aria-labelledby="capture-review-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading
          level={level}
          id="capture-review-title"
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {summary.total === 0
            ? 'Sin actividades'
            : `${summary.total} ${summary.total === 1 ? 'actividad encontrada' : 'actividades encontradas'}`}
        </Heading>
        <p className="text-sm text-muted-foreground">
          Nada se guarda hasta que pulses «{label}». Lo que no tiene dudas ya está listo.
        </p>
      </div>

      {openTime.map((c) => {
        const first = itemsOf(c.clientIds)[0];
        return (
          <Card key={c.key} as="div" variant="accent" className="flex flex-col gap-2 p-4">
            <p className="font-medium">Una sola respuesta para {c.clientIds.length} actividades</p>
            <p className="text-sm text-muted-foreground">{describe(c.clientIds)}</p>
            {first && (
              <TimeAsk
                id={`group-${c.key.replace(/[^a-z0-9]/gi, '')}`}
                alternatives={c.alternatives}
                value={state.groupTime[c.key] ?? ''}
                onPick={(t) => onChange(chooseGroupTime(state, c.key, t))}
              />
            )}
          </Card>
        );
      })}

      {openSubject.map((c) => {
        const first = itemsOf(c.clientIds)[0];
        if (!first || first.proposal.subject.kind !== 'UNRESOLVED') return null;
        return (
          <Card key={c.key} as="div" variant="accent" className="flex flex-col gap-2 p-4">
            <p className="font-medium">Una sola respuesta para {c.clientIds.length} actividades</p>
            <p className="text-sm text-muted-foreground">{describe(c.clientIds)}</p>
            <SubjectQuestion
              id={`group-${c.key.replace(/[^a-z0-9]/gi, '')}`}
              subject={first.proposal.subject}
              subjects={subjects}
              title={null}
              onPick={(choice) => onChange(chooseGroupSubject(state, c.key, choice))}
            />
          </Card>
        );
      })}

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
        >
          <p>{error}</p>
          {onConfirmAnyway && (
            <div>
              <Button size="sm" onClick={onConfirmAnyway} disabled={pending}>
                Crear de todos modos
              </Button>
            </div>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {state.items.map((item, i) => (
          <CaptureCard
            key={item.proposal.clientId}
            index={i}
            item={item}
            state={state}
            subjects={subjects}
            actions={actionsFor(item.proposal.clientId)}
            level={(level + 1) as 3 | 4}
            disabled={pending}
          />
        ))}
      </ul>

      {state.suggestions.length > 0 && (
        <Card variant="soft" className="flex flex-col gap-2 p-4 text-sm">
          {state.suggestions.map((s) => (
            <p key={s.clientId}>
              <span className="font-medium">«{s.title.value}» parece repetirse cada semana</span>
              {s.slots.length > 0 && (
                <>
                  {' '}
                  (
                  {s.slots
                    .map(
                      (x) =>
                        `${WEEKDAYS[x.weekday - 1]}${x.time.value ? ` ${clockLabel(x.time.value)}` : ''}`,
                    )
                    .join(', ')}
                  )
                </>
              )}
              . No la creé como actividades: si es una clase, agrégala a tu{' '}
              <Link to="/calendar" className="font-medium underline">
                horario
              </Link>
              .
            </p>
          ))}
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {summary.newSubjects.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Se{' '}
            {summary.newSubjects.length === 1 ? 'creará la asignatura' : 'crearán las asignaturas'}{' '}
            {summary.newSubjects.map((n) => `«${n}»`).join(', ')}.
          </p>
        )}
        {waiting > 0 && (
          <p role="status" className="text-sm text-warning-ink">
            {waiting === 1
              ? 'Falta resolver 1 actividad marcada.'
              : `Faltan por resolver ${waiting} actividades marcadas.`}{' '}
            Complétalas o desmárcalas para continuar.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={pending || count === 0 || waiting > 0}
            aria-busy={pending || undefined}
          >
            {pending ? `Creando ${count} ${count === 1 ? 'actividad' : 'actividades'}…` : label}
          </Button>
          <Button onClick={onBack} disabled={pending}>
            Volver al texto
          </Button>
          <Button variant="ghost" onClick={onDiscard} disabled={pending}>
            Descartar
          </Button>
        </div>
      </div>
    </section>
  );
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
