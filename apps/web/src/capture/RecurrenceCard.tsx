import type { Subject } from '@planner/core';
import { useState } from 'react';
import { FormField } from '../components/FormField';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CheckIcon, ChevronDownIcon } from '../components/ui/icons';
import {
  askClass,
  Heading,
  SubjectPicker,
  SubjectQuestion,
  subjectLabel,
  TimeAsk,
} from './CaptureCard';
import { clockLabel } from './format';
import {
  effectiveRecurrenceSubject,
  effectiveRecurrenceTitle,
  effectiveSlots,
  isCreatable,
  recurrencePendingOf,
  type EffectiveSlot,
  type ReviewRecurrence,
  type SubjectChoice,
} from './reviewModel';

/** What a schedule card may change. Each one is a change of THIS schedule only. */
export interface RecurrenceActions {
  setTitle: (v: string) => void;
  setSubject: (v: SubjectChoice) => void;
  toggleDay: (weekday: number) => void;
  setTime: (weekday: number, which: 'start' | 'end', value: string) => void;
  setSharedStart: (v: string) => void;
  setSharedEnd: (v: string) => void;
  toggle: (selected: boolean) => void;
  remove: () => void;
}

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** [2, 4] -> "martes y jueves"; [1, 3, 5] -> "lunes, miércoles y viernes". */
export function daysPhrase(weekdays: readonly number[]): string {
  const names = weekdays.map((d) => DAY_NAMES[d - 1]!);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

const range = (x: EffectiveSlot) =>
  x.start && x.end
    ? `${clockLabel(x.start)} – ${clockLabel(x.end)}`
    : x.start
      ? `${clockLabel(x.start)} · falta la hora final`
      : 'Hora por decidir';

/** The lines of the card: weekdays that share their times are one line ("Todos los martes y jueves · 6:00 p. m. – 8:00 p. m."). */
export function scheduleLines(slots: readonly EffectiveSlot[]): string[] {
  const groups = new Map<string, number[]>();
  for (const x of slots) {
    const key = range(x);
    groups.set(key, [...(groups.get(key) ?? []), x.weekday]);
  }
  const several = groups.size > 1;
  return [...groups].map(([times, days]) => {
    const phrase = daysPhrase(days);
    return `${several ? 'Los' : 'Todos los'} ${phrase} · ${times}`;
  });
}

/**
 * One weekly schedule. READY says only what it will create ("Todos los martes y jueves · 6:00 p. m. – 8:00 p. m."); a
 * schedule with a doubt shows ONLY that doubt. The fields to change anything else are one tap away ("Editar").
 * A repeating activity ("un quiz todos los viernes") is only explained: it has no tick and creates nothing.
 */
export function RecurrenceCard({
  recurrence: r,
  subjects,
  actions,
  level,
  disabled,
}: {
  recurrence: ReviewRecurrence;
  subjects: readonly Subject[];
  actions: RecurrenceActions;
  level: 3 | 4;
  disabled?: boolean;
}) {
  const { suggestion: s } = r;
  const id = `capture-${s.clientId}`;
  const [editing, setEditing] = useState(false);
  const title = effectiveRecurrenceTitle(r);
  const slots = effectiveSlots(r);

  if (!isCreatable(r)) {
    const days = daysPhrase(s.slots.map((x) => x.weekday));
    return (
      <li>
        <Card
          as="article"
          variant="soft"
          aria-labelledby={`${id}-title`}
          className="flex flex-col gap-2 p-4"
        >
          <header className="flex flex-wrap items-center gap-2">
            <Heading
              level={level}
              id={`${id}-title`}
              className="text-base font-semibold break-words"
            >
              {title || 'Actividad'}
            </Heading>
            <Badge tone="info">Se repite</Badge>
          </header>
          <p className="text-sm">
            Parece una actividad que se repite cada {days}. La repetición automática de actividades
            todavía no está disponible.
          </p>
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={actions.remove}
              aria-label={`Quitar ${title}`}
            >
              Quitar
            </Button>
          </div>
        </Card>
      </li>
    );
  }

  const pending = recurrencePendingOf(r);
  const complete = pending.length === 0;
  const subject = effectiveRecurrenceSubject(r);
  const label = `${title || 'Sin título'}, horario semanal`;
  const missingStart = s.slots.find((x) => x.time.value === null);
  const endIssue = s.blockingIssues.find((b) => b.code === 'END_TIME_MISSING')?.message;
  const startIssue = s.blockingIssues.find((b) => b.code === 'START_TIME_MISSING')?.message;

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
              checked={r.selected}
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
              <span className="sr-only">Horario semanal: </span>
              {title || 'Sin título'}
            </Heading>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="info">Horario semanal</Badge>
              <span className="text-sm text-muted-foreground">{subjectLabel(subject)}</span>
            </div>
            <ul className="mt-1 flex flex-col text-sm break-words text-muted-foreground">
              {scheduleLines(slots).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
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

        {r.error && (
          <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger-ink">
            {r.error}
          </p>
        )}

        {pending.includes('title') && (
          <div className={askClass}>
            <FormField
              id={`${id}-title-input`}
              label="¿Cómo se llama?"
              value={r.title ?? ''}
              onChange={actions.setTitle}
            />
          </div>
        )}

        {pending.includes('subject') &&
          (s.subject.kind === 'UNRESOLVED' ? (
            <SubjectQuestion
              id={id}
              subject={s.subject}
              subjects={subjects}
              onPick={actions.setSubject}
              title={null}
              allowNone={s.blockType !== 'CLASS'}
            />
          ) : (
            <div className={askClass} role="group" aria-label="Asignatura por decidir">
              <SubjectPicker
                id={`${id}-subject`}
                value={subject}
                subjects={subjects}
                onPick={actions.setSubject}
                allowNone={s.blockType !== 'CLASS'}
              />
            </div>
          ))}

        {pending.includes('days') && (
          <p role="status" className={askClass}>
            Elige al menos un día en «Editar».
          </p>
        )}

        {pending.includes('start') && (
          <TimeAsk
            id={`${id}-start`}
            alternatives={missingStart?.time.alternatives ?? []}
            value={r.sharedStart ?? ''}
            onPick={actions.setSharedStart}
            hint={startIssue ?? 'Una sola respuesta sirve para todos los días.'}
          />
        )}

        {pending.includes('end') && !pending.includes('start') && (
          <div className={askClass} role="group" aria-label="Hora final por decidir">
            <p className="font-medium">¿Hasta qué hora?</p>
            <p className="text-muted-foreground">
              {endIssue && endIssue !== '¿Hasta qué hora?'
                ? endIssue
                : 'No inventé la hora final. Una sola respuesta sirve para todos los días.'}
            </p>
            <FormField
              id={`${id}-end`}
              label="Hora final"
              type="time"
              value={r.sharedEnd ?? ''}
              onChange={actions.setSharedEnd}
            />
          </div>
        )}

        {subject?.kind === 'NEW' && (
          <p className="text-sm text-muted-foreground">
            Se creará la asignatura «{subject.name}» al confirmar.
          </p>
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
            <SubjectPicker
              id={`${id}-edit-subject`}
              value={subject}
              subjects={subjects}
              onPick={actions.setSubject}
              allowNone={s.blockType !== 'CLASS'}
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Días</legend>
              <div className="flex flex-wrap gap-2">
                {DAY_NAMES.map((name, i) => {
                  const on = slots.some((x) => x.weekday === i + 1);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => actions.toggleDay(i + 1)}
                      className={`min-h-11 min-w-11 rounded-control border px-3 text-sm font-medium ${
                        on
                          ? 'border-accent bg-accent-soft text-accent-ink'
                          : 'border-border bg-surface text-foreground'
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {slots.map((x) => (
              <div key={x.weekday} className="grid grid-cols-2 gap-3">
                <FormField
                  id={`${id}-edit-start-${x.weekday}`}
                  label={`Inicio del ${DAY_NAMES[x.weekday - 1]}`}
                  type="time"
                  value={x.start}
                  onChange={(v) => actions.setTime(x.weekday, 'start', v)}
                />
                <FormField
                  id={`${id}-edit-end-${x.weekday}`}
                  label={`Fin del ${DAY_NAMES[x.weekday - 1]}`}
                  type="time"
                  value={x.end}
                  onChange={(v) => actions.setTime(x.weekday, 'end', v)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </li>
  );
}
