import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  type ActivityType,
  type Subject,
} from '@planner/core';
import { useState, type ComponentPropsWithoutRef } from 'react';
import { FormField } from '../components/FormField';
import { SelectField } from '../components/SelectField';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { AlertIcon, CheckIcon, ChevronDownIcon } from '../components/ui/icons';
import { clockLabel, humanDate } from './format';
import {
  effectiveDate,
  effectiveSubject,
  effectiveTime,
  effectiveTitle,
  effectiveType,
  pendingOf,
  subjectCorrectionOf,
  timeCorrectionOf,
  type PendingField,
  type ReviewItem,
  type ReviewState,
  type SubjectChoice,
} from './reviewModel';

/** What a card may change about its proposal. Each one is a change of THIS proposal only. */
export interface CardActions {
  setTitle: (v: string) => void;
  setType: (v: ActivityType) => void;
  setDate: (v: string) => void;
  setTime: (v: string) => void;
  setSubject: (v: SubjectChoice) => void;
  toggle: (selected: boolean) => void;
  remove: () => void;
}

interface Props {
  index: number;
  item: ReviewItem;
  state: ReviewState;
  subjects: readonly Subject[];
  actions: CardActions;
  /** The heading level of the card: one below the heading of the review it is in. */
  level: 3 | 4;
  /** The question belongs to a shared one answered above: this card just says it is waiting for it. */
  disabled?: boolean;
}

const NEW_SUBJECT = '__new__';
const NO_SUBJECT = '__none__';

const askClass =
  'flex flex-col gap-2 rounded-control border border-warning-line bg-warning-soft/60 p-3 text-sm';

/** A heading whose level the place decides (a card sits one level below the review that holds it). */
export function Heading({ level, ...rest }: { level: 2 | 3 | 4 } & ComponentPropsWithoutRef<'h2'>) {
  const Tag = `h${level}` as 'h2';
  return <Tag {...rest} />;
}

export function subjectLabel(choice: SubjectChoice | undefined): string {
  if (!choice) return 'Asignatura por decidir';
  if (choice.kind === 'NONE') return 'Sin asignatura';
  if (choice.kind === 'NEW') return `«${choice.name}» (nueva)`;
  return choice.name;
}

/** The sentence a proposal is: what will be created, in the student's own words. */
export function summaryOf(state: ReviewState, item: ReviewItem): string {
  const date = effectiveDate(item);
  const time = effectiveTime(state, item);
  const parts = [
    date ? humanDate(date) : 'Sin fecha',
    time ? clockLabel(time) : time === '' ? 'Sin hora' : 'Hora por decidir',
    ACTIVITY_TYPE_LABELS[effectiveType(item)],
    subjectLabel(effectiveSubject(state, item)),
  ];
  return parts.join(' · ');
}

/**
 * One proposal. READY says only what it will create; a proposal with a doubt shows ONLY that doubt, in the place of the
 * answer. The fields to change anything else are one tap away ("Editar"), never open by default.
 */
export function CaptureCard({ index, item, state, subjects, actions, level, disabled }: Props) {
  const { proposal: p } = item;
  const id = `capture-${p.clientId}`;
  const pending = pendingOf(state, item);
  const complete = pending.length === 0;
  const [editing, setEditing] = useState(false);
  const [own, setOwn] = useState<Partial<Record<PendingField, boolean>>>({});

  const title = effectiveTitle(item);
  const subject = effectiveSubject(state, item);
  const timeGroup = timeCorrectionOf(state, item);
  const subjectGroup = subjectCorrectionOf(state, item);
  const date = effectiveDate(item);
  const chosenTime = effectiveTime(state, item);
  const label = `${title || 'Sin título'}${date ? ` del ${humanDate(date).toLowerCase()}` : ''}`;

  // A question shared with other proposals is answered once, above; here it only waits (unless answered for this one).
  const waitsFor = (field: PendingField) =>
    pending.includes(field) &&
    !own[field] &&
    ((field === 'time' && timeGroup !== null) || (field === 'subject' && subjectGroup !== null));

  const notes = p.warnings.filter((w) => w.code !== 'POSSIBLE_DUPLICATE');

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
              checked={item.selected}
              onChange={(e) => actions.toggle(e.target.checked)}
              disabled={disabled}
              aria-label={`Incluir ${label}`}
              className="size-5 accent-[var(--accent)]"
            />
          </label>
          <div className="min-w-0 flex-1">
            <Heading
              level={level}
              id={`${id}-title`}
              className="text-base font-semibold break-words"
            >
              <span className="sr-only">Propuesta {index + 1}: </span>
              {title || 'Sin título'}
            </Heading>
            <p className="text-sm break-words text-muted-foreground">{summaryOf(state, item)}</p>
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

        {item.error && (
          <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger-ink">
            {item.error}
          </p>
        )}

        {/* The doubts: only the field that has one. */}
        {pending.includes('title') && (
          <div className={askClass}>
            <FormField
              id={`${id}-title-input`}
              label="¿Cómo se llama?"
              value={item.title ?? ''}
              onChange={actions.setTitle}
            />
          </div>
        )}

        {pending.includes('date') && (
          <div className={askClass} role="group" aria-label="Fecha por decidir">
            <p className="font-medium">
              {p.date.alternatives.length > 1
                ? 'El texto da más de una fecha: ¿cuál?'
                : p.date.alternatives.length === 1
                  ? '¿Es esta la fecha?'
                  : '¿Qué día es?'}
            </p>
            {p.date.alternatives.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {p.date.alternatives.map((d) => (
                  <Button key={d} size="sm" onClick={() => actions.setDate(d)}>
                    {humanDate(d)}
                  </Button>
                ))}
              </div>
            )}
            <FormField
              id={`${id}-date`}
              label="Fecha"
              type="date"
              value={item.date ?? ''}
              onChange={actions.setDate}
            />
          </div>
        )}

        {pending.includes('time') &&
          (waitsFor('time') ? (
            <div className={askClass}>
              <p>
                <AlertIcon className="mr-1 inline size-4 align-text-bottom" />
                La hora se responde arriba, una vez para todas.
              </p>
              <div>
                <Button size="sm" onClick={() => setOwn((o) => ({ ...o, time: true }))}>
                  Cambiar solo en esta
                </Button>
              </div>
            </div>
          ) : (
            <TimeAsk
              id={id}
              alternatives={p.time.alternatives}
              value={item.time ?? ''}
              onPick={actions.setTime}
              hint={p.blockingIssues.find((b) => b.field === 'time')?.message}
            />
          ))}

        {pending.includes('subject') &&
          (waitsFor('subject') ? (
            <div className={askClass}>
              <p>
                <AlertIcon className="mr-1 inline size-4 align-text-bottom" />
                La asignatura se responde arriba, una vez para todas.
              </p>
              <div>
                <Button size="sm" onClick={() => setOwn((o) => ({ ...o, subject: true }))}>
                  Cambiar solo en esta
                </Button>
              </div>
            </div>
          ) : (
            <SubjectQuestion
              id={id}
              subject={p.subject}
              subjects={subjects}
              onPick={actions.setSubject}
              title={null}
            />
          ))}

        {subject?.kind === 'NEW' && (
          <p className="text-sm text-muted-foreground">
            Se creará la asignatura «{subject.name}» al confirmar.
          </p>
        )}
        {p.duplicateOf && (
          <p className="text-sm text-muted-foreground">
            Ya tienes «{p.duplicateOf.title}» ese día. Márcala si la quieres otra vez.
          </p>
        )}
        {notes.length > 0 && (
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
            {notes.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-controls={`${id}-edit`}
            className="inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-sm font-medium text-accent-ink hover:bg-secondary"
          >
            Editar
            <ChevronDownIcon
              className={`size-4 transition-transform duration-(--duration-normal) ${editing ? 'rotate-180' : ''}`}
            />
          </button>
          <Button size="sm" variant="ghost" onClick={actions.remove} aria-label={`Quitar ${label}`}>
            Quitar
          </Button>
        </div>

        {editing && (
          <div id={`${id}-edit`} className="flex flex-col gap-3 border-t border-border pt-3">
            <FormField
              id={`${id}-edit-title`}
              label="Título"
              value={title}
              onChange={actions.setTitle}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id={`${id}-edit-date`}
                label="Fecha"
                type="date"
                value={date}
                onChange={actions.setDate}
              />
              <div className="flex flex-col gap-1.5">
                <FormField
                  id={`${id}-edit-time`}
                  label="Hora (opcional)"
                  type="time"
                  value={chosenTime ?? ''}
                  onChange={actions.setTime}
                />
              </div>
            </div>
            <SelectField
              id={`${id}-edit-type`}
              label="Tipo"
              value={effectiveType(item)}
              onChange={(v) => actions.setType(v as ActivityType)}
              options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
            />
            <SubjectPicker
              id={`${id}-edit-subject`}
              value={subject}
              subjects={subjects}
              onPick={actions.setSubject}
            />
          </div>
        )}
      </Card>
    </li>
  );
}

// ───────────────────────── Questions ─────────────────────────

/** The hour is a question: the readings the text allows as buttons, "Sin hora", or any hour typed. */
export function TimeAsk({
  id,
  alternatives,
  value,
  onPick,
  hint,
}: {
  id: string;
  alternatives: readonly string[];
  value: string;
  onPick: (time: string) => void;
  hint?: string;
}) {
  return (
    <div className={askClass} role="group" aria-label="Hora por decidir">
      <p className="font-medium">{isAmPm(alternatives) ? '¿a. m. o p. m.?' : '¿A qué hora?'}</p>
      {hint && <p className="text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {alternatives.map((t) => (
          <Button key={t} size="sm" onClick={() => onPick(t)}>
            {clockLabel(t)}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onPick('')}>
          Sin hora
        </Button>
      </div>
      <FormField id={`${id}-time`} label="Otra hora" type="time" value={value} onChange={onPick} />
    </div>
  );
}

/** Two readings of the same time twelve hours apart (7:30 / 19:30): the question is "a. m. or p. m.". */
const isAmPm = (alternatives: readonly string[]) => {
  if (alternatives.length !== 2) return false;
  const [a, b] = alternatives.map((t) => Number(t.slice(0, 2)));
  return b! - a! === 12 && alternatives[0]!.slice(2) === alternatives[1]!.slice(2);
};

/**
 * The subject question, for a card or for several: UNKNOWN_NAME offers to create the name (nothing is created until
 * everything is confirmed), AMBIGUOUS offers its candidates; both can pick another subject or leave it out.
 */
export function SubjectQuestion({
  id,
  subject,
  subjects,
  onPick,
  title,
}: {
  id: string;
  subject: ReviewItem['proposal']['subject'];
  subjects: readonly Subject[];
  onPick: (c: SubjectChoice) => void;
  title: string | null;
}) {
  const [other, setOther] = useState(false);
  if (subject.kind !== 'UNRESOLVED') return null;
  const exists = (name: string) =>
    subjects.find((s) => s.name.toLowerCase() === name.toLowerCase());
  const suggested = subject.suggestedName;
  const sameName = suggested ? exists(suggested) : undefined;
  return (
    <div className={askClass} role="group" aria-label="Asignatura por decidir">
      <p className="font-medium">
        {title ??
          (subject.reason === 'UNKNOWN_NAME'
            ? `No tienes la asignatura «${suggested}».`
            : '¿A cuál asignatura te refieres?')}
      </p>
      <div className="flex flex-wrap gap-2">
        {subject.reason === 'UNKNOWN_NAME' && suggested && (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              onPick(
                sameName
                  ? { kind: 'EXISTING', id: sameName.id, name: sameName.name }
                  : { kind: 'NEW', name: suggested },
              )
            }
          >
            Crear «{suggested}»
          </Button>
        )}
        {subject.candidates.map((c) => (
          <Button
            key={c.id}
            size="sm"
            onClick={() => onPick({ kind: 'EXISTING', id: c.id, name: c.name })}
          >
            {c.name}
          </Button>
        ))}
        {subjects.length > 0 && !other && (
          <Button size="sm" onClick={() => setOther(true)}>
            Elegir otra
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onPick({ kind: 'NONE' })}>
          Sin asignatura
        </Button>
      </div>
      {other && (
        <SelectField
          id={`${id}-other-subject`}
          label="Asignatura"
          placeholder="Elige una asignatura"
          value=""
          onChange={(v) => {
            const s = subjects.find((x) => x.id === v);
            if (s) onPick({ kind: 'EXISTING', id: s.id, name: s.name });
          }}
          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
    </div>
  );
}

/** The always-available way to set the subject of ONE proposal: none, one of theirs, or a new one by name. */
function SubjectPicker({
  id,
  value,
  subjects,
  onPick,
}: {
  id: string;
  value: SubjectChoice | undefined;
  subjects: readonly Subject[];
  onPick: (c: SubjectChoice) => void;
}) {
  const [newName, setNewName] = useState(value?.kind === 'NEW' ? value.name : '');
  const [creating, setCreating] = useState(value?.kind === 'NEW');
  const selected = creating
    ? NEW_SUBJECT
    : value?.kind === 'EXISTING'
      ? value.id
      : value?.kind === 'NONE'
        ? NO_SUBJECT
        : '';
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        id={id}
        label="Asignatura"
        placeholder={value ? undefined : 'Elige una asignatura'}
        value={selected}
        onChange={(v) => {
          if (v === NEW_SUBJECT) {
            setCreating(true);
            if (newName.trim()) onPick({ kind: 'NEW', name: newName.trim() });
          } else if (v === NO_SUBJECT) {
            setCreating(false);
            onPick({ kind: 'NONE' });
          } else {
            const s = subjects.find((x) => x.id === v);
            setCreating(false);
            if (s) onPick({ kind: 'EXISTING', id: s.id, name: s.name });
          }
        }}
        options={[
          { value: NO_SUBJECT, label: 'Sin asignatura' },
          ...subjects.map((s) => ({ value: s.id, label: s.name })),
          { value: NEW_SUBJECT, label: 'Crear asignatura nueva…' },
        ]}
      />
      {creating && (
        <FormField
          id={`${id}-new-name`}
          label="Nombre de la asignatura nueva"
          value={newName}
          onChange={(v) => {
            setNewName(v);
            if (v.trim()) onPick({ kind: 'NEW', name: v.trim() });
          }}
          hint="Se crea al confirmar, no antes."
        />
      )}
    </div>
  );
}
