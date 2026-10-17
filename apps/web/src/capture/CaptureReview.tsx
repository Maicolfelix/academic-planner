import { type Subject } from '@planner/core';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { AlertIcon } from '../components/ui/icons';
import { CaptureCard, Heading, SubjectQuestion, TimeAsk, type CardActions } from './CaptureCard';
import { GradeCard, type GradeActions } from './GradeCard';
import { RecurrenceCard, type RecurrenceActions } from './RecurrenceCard';
import { shortDate } from './format';
import {
  agendaBlocked,
  chooseGroupSubject,
  chooseGroupTime,
  confirmLabel,
  effectiveDate,
  effectiveTitle,
  isCreatable,
  isGradeComplete,
  pendingOf,
  recurrencePendingOf,
  remove,
  removeGrades,
  setGradeBasis,
  setGradeCanonical,
  setGradeSubject,
  setGradeTarget,
  toggleGrade,
  removeRecurrences,
  setDate,
  setDescription,
  setRecurrenceSharedEnd,
  setRecurrenceSharedStart,
  setRecurrenceSubject,
  setRecurrenceTime,
  setRecurrenceTitle,
  setSubject,
  setTime,
  setTitle,
  setType,
  summarize,
  toggle,
  toggleRecurrence,
  toggleRecurrenceDay,
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
    setDescription: (v) => onChange(setDescription(state, clientId, v)),
    toggle: (v) => onChange(toggle(state, clientId, v)),
    remove: () => onChange(remove(state, clientId)),
  });

  const recurrenceActions = (clientId: string): RecurrenceActions => ({
    setTitle: (v) => onChange(setRecurrenceTitle(state, clientId, v)),
    setSubject: (v) => onChange(setRecurrenceSubject(state, clientId, v)),
    toggleDay: (d) => onChange(toggleRecurrenceDay(state, clientId, d)),
    setTime: (d, which, v) => onChange(setRecurrenceTime(state, clientId, d, which, v)),
    setSharedStart: (v) => onChange(setRecurrenceSharedStart(state, clientId, v)),
    setSharedEnd: (v) => onChange(setRecurrenceSharedEnd(state, clientId, v)),
    toggle: (v) => onChange(toggleRecurrence(state, clientId, v)),
    remove: () => onChange(removeRecurrences(state, new Set([clientId]))),
  });

  const gradeActions = (clientId: string): GradeActions => ({
    setSubject: (v) => onChange(setGradeSubject(state, clientId, v)),
    setTarget: (v) => onChange(setGradeTarget(state, clientId, v)),
    setBasis: (v) => onChange(setGradeBasis(state, clientId, v)),
    setCanonical: (v) => onChange(setGradeCanonical(state, clientId, v)),
    toggle: (v) => onChange(toggleGrade(state, clientId, v)),
    remove: () => onChange(removeGrades(state, new Set([clientId]))),
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
      .map((i) => `${effectiveTitle(state, i)} (${shortDate(effectiveDate(i))})`)
      .join(', ');

  const goToFirstToReview = () => {
    const first =
      state.items.find((i) => pendingOf(state, i).length > 0)?.proposal.clientId ??
      state.recurrences.find((r) => isCreatable(r) && recurrencePendingOf(r).length > 0)?.suggestion
        .clientId ??
      state.grades.find((g) => !isGradeComplete(g))?.suggestion.clientId;
    if (!first) return;
    const target = document.getElementById(`capture-${first}-title`);
    target?.scrollIntoView({ block: 'center' });
    target?.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
  };

  const count = summary.toCreate + summary.blocksToCreate + summary.gradesToCreate;
  const label = confirmLabel(summary);
  const waiting = summary.incomplete;
  const found = summary.total + summary.schedules + summary.grades;
  const headingParts = [
    summary.total > 0 &&
      `${summary.total} ${summary.total === 1 ? 'actividad encontrada' : 'actividades encontradas'}`,
    summary.schedules > 0 &&
      `${summary.schedules} ${summary.schedules === 1 ? 'horario semanal' : 'horarios semanales'}`,
    summary.grades > 0 && `${summary.grades} ${summary.grades === 1 ? 'nota' : 'notas'}`,
    summary.unsupported > 0 &&
      `${summary.unsupported} ${summary.unsupported === 1 ? 'actividad que se repite' : 'actividades que se repiten'}`,
  ].filter(Boolean);

  return (
    <section aria-labelledby="capture-review-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading
          level={level}
          id="capture-review-title"
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {headingParts.length === 0
            ? 'Nada que crear'
            : [headingParts.slice(0, -1).join(', '), headingParts.at(-1)]
                .filter(Boolean)
                .join(' y ')}
        </Heading>
        {found > 1 && (
          <p className="text-sm font-medium">
            {found - summary.needsReview} {found - summary.needsReview === 1 ? 'lista' : 'listas'}
            {summary.needsReview > 0 &&
              `, ${summary.needsReview} ${summary.needsReview === 1 ? 'necesita' : 'necesitan'} revisión`}
          </p>
        )}
        {state.notice && (
          <p
            role="status"
            className="flex gap-2 rounded-control border border-warning-line bg-warning-soft/60 p-3 text-sm"
          >
            <AlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{state.notice} Revisa las que encontré y marca las que quieras crear.</span>
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Nada se guarda hasta que pulses «{label}». Lo que no tiene dudas ya está listo.
        </p>
        {summary.needsReview > 0 && found > 4 && (
          <div>
            <Button size="sm" onClick={goToFirstToReview}>
              Ir a la primera que necesita revisión
            </Button>
          </div>
        )}
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
        {state.grades.map((g) => (
          <GradeCard
            key={g.suggestion.clientId}
            grade={g}
            actions={gradeActions(g.suggestion.clientId)}
            level={(level + 1) as 3 | 4}
            disabled={pending}
            agendaNote={
              g.suggestion.activityNote === 'OTHER_STUDY' ||
              (g.suggestion.activityClientId !== null &&
                agendaBlocked(state, g.suggestion.activityClientId))
            }
          />
        ))}
        {state.recurrences.map((r) => (
          <RecurrenceCard
            key={r.suggestion.clientId}
            recurrence={r}
            subjects={subjects}
            actions={recurrenceActions(r.suggestion.clientId)}
            level={(level + 1) as 3 | 4}
            disabled={pending}
          />
        ))}
      </ul>

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
            {summary.schedules === 0
              ? waiting === 1
                ? 'Falta resolver 1 actividad marcada.'
                : `Faltan por resolver ${waiting} actividades marcadas.`
              : waiting === 1
                ? 'Falta resolver 1 elemento marcado.'
                : `Faltan por resolver ${waiting} elementos marcados.`}{' '}
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
            {pending ? confirmLabel(summary, true) : label}
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
