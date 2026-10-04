import {
  SCHEDULE_BLOCK_TYPES,
  SCHEDULE_BLOCK_TYPE_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  WEEKLY_EDIT_NOTICE,
  createScheduleBlockSchema,
  fieldErrorsOf,
  firstWeekdayOnOrAfter,
  toLocalParts,
  updateScheduleBlockSchema,
  weekdayOf,
  type AcademicPeriod,
  type ScheduleBlock,
  type ScheduleBlockType,
  type ScheduleWarning,
  type Weekday,
} from '@planner/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSubjects } from '../../academic/useAcademic';
import { ApiRequestError } from '../../api/client';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { SelectField } from '../../components/SelectField';
import { useSaveScheduleBlock } from '../../schedule/useSchedule';

interface Props {
  /** Present when editing. */
  block?: ScheduleBlock;
  periods: AcademicPeriod[];
  currentPeriod: AcademicPeriod;
  /** Day the new block starts on (the selected day), clamped into the period. */
  defaultDate: string;
  timeZone: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Edit mode only: hands over to the delete confirmation. */
  onDelete?: () => void;
}

interface Pending {
  signature: string;
  input: Record<string, unknown>;
  warnings: ScheduleWarning[];
}

const clamp = (date: string, period: AcademicPeriod) =>
  date < period.startDate ? period.startDate : date > period.endDate ? period.endDate : date;

/**
 * One form for a single block and for a weekly series. With "Repetir semanalmente" the student picks a
 * WEEKDAY (the API takes the first date, computed here with a core function) and an end date that
 * defaults to the end of the period. A clash with another block is shown BEFORE saving, with the option
 * to save anyway: the app warns, it never decides for the student.
 */
export function BlockFormDialog({
  block,
  periods,
  currentPeriod,
  defaultDate,
  timeZone,
  onClose,
  onSaved,
  onDelete,
}: Props) {
  const period =
    periods.find((p) => p.id === (block?.periodId ?? currentPeriod.id)) ?? currentPeriod;
  const subjects = useSubjects(period.id).data ?? [];
  const save = useSaveScheduleBlock();

  const firstDate = block?.date ?? clamp(defaultDate, period);
  const [type, setType] = useState<ScheduleBlockType>(block?.type ?? 'CLASS');
  const [subjectId, setSubjectId] = useState(block?.subjectId ?? '');
  const [title, setTitle] = useState(block?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(Boolean(block));
  const [repeat, setRepeat] = useState(block ? block.recurrence !== null : true);
  const [repeatTouched, setRepeatTouched] = useState(Boolean(block));
  // The API validates it as an integer 1–7, which is exactly `Weekday`.
  const [weekday, setWeekday] = useState<Weekday>(
    (block?.recurrence?.weekday as Weekday | undefined) ?? weekdayOf(firstDate),
  );
  const [date, setDate] = useState(firstDate);
  const [startTime, setStartTime] = useState(block?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(block?.endTime ?? '10:00');
  const [until, setUntil] = useState(block?.recurrence?.until ?? period.endDate);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState<Pending>();

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? '';

  // Auto-title: a class takes the name of its subject until the student types their own title.
  function changeType(next: ScheduleBlockType) {
    setType(next);
    if (!repeatTouched) setRepeat(next === 'CLASS');
    if (next === 'CLASS' && !titleTouched && subjectId) setTitle(subjectName(subjectId));
  }
  function changeSubject(id: string) {
    setSubjectId(id);
    if (type === 'CLASS' && !titleTouched) setTitle(subjectName(id));
  }

  /** What the API receives. The first date of a series comes from the weekday, as a plain calendar date. */
  function buildInput(): Record<string, unknown> {
    const seriesDate = firstWeekdayOnOrAfter(period.startDate, weekday);
    const weekdayUnchanged = block
      ? weekday === (block.recurrence?.weekday ?? weekdayOf(block.date))
      : false;
    const base = {
      type,
      subjectId: subjectId || null,
      title,
      startTime,
      endTime,
      recurrence: repeat ? { frequency: 'WEEKLY', until } : null,
    };
    if (!repeat) return { ...base, date };
    // Editing a series keeps its first date unless the weekday changed.
    if (block && weekdayUnchanged) return base;
    return { ...base, date: seriesDate };
  }

  const input = buildInput();
  const signature = JSON.stringify(input);

  function onError(err: Error) {
    if (err instanceof ApiRequestError && Object.keys(err.fieldErrors).length > 0) {
      setFieldErrors(err.fieldErrors);
    } else {
      setFormError(err.message);
    }
  }

  function commit(toSave: Record<string, unknown>) {
    save.mutate(
      { id: block?.id, input: toSave },
      {
        onSuccess: (result) =>
          onSaved(
            `${block ? 'Bloque actualizado.' : 'Bloque creado.'}${
              result.warnings.length > 0 ? ` ${result.warnings[0]!.message}` : ''
            }`,
          ),
        onError,
      },
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);

    const schema = block ? updateScheduleBlockSchema : createScheduleBlockSchema;
    const parsed = schema.safeParse(input);
    if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
    setFieldErrors({});

    // The student already saw this exact warning and chose to continue.
    if (pending?.signature === signature) return commit(input);

    // Look for clashes first (nothing is saved), so the warning comes before the save.
    save.mutate(
      { id: block?.id, input, dryRun: true },
      {
        onSuccess: (result) => {
          if (result.warnings.length > 0)
            setPending({ signature, input, warnings: result.warnings });
          else commit(input);
        },
        onError,
      },
    );
  }

  const showWarning = pending !== undefined && pending.signature === signature;

  // On a phone the warning appears below the fold of the dialog: bring it into view.
  const warningRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (showWarning) warningRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showWarning]);
  const describe = (w: ScheduleWarning) => {
    const start = toLocalParts(w.with.startAt, timeZone);
    const end = toLocalParts(w.with.endAt, timeZone);
    const day = WEEKDAY_SHORT_LABELS[weekdayOf(start.date)].toLowerCase();
    const more = w.with.occurrences > 1 ? ` (se cruza en ${w.with.occurrences} semanas)` : '';
    return `«${w.with.title}» (${day} ${start.time}–${end.time})${more}`;
  };

  return (
    <Modal title={block ? 'Editar bloque' : 'Agregar bloque'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {formError}
          </p>
        )}

        <SelectField
          id="block-type"
          label="Tipo"
          value={type}
          onChange={(v) => changeType(v as ScheduleBlockType)}
          options={SCHEDULE_BLOCK_TYPES.map((t) => ({
            value: t,
            label: SCHEDULE_BLOCK_TYPE_LABELS[t],
          }))}
          error={fieldErrors.type?.[0]}
        />
        <SelectField
          id="block-subject"
          label="Asignatura"
          placeholder={type === 'CLASS' ? 'Elige una asignatura' : 'Sin asignatura'}
          value={subjectId}
          onChange={changeSubject}
          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
          error={fieldErrors.subjectId?.[0]}
        />
        <FormField
          id="block-title"
          label="Título"
          value={title}
          onChange={(v) => {
            setTitle(v);
            // A title the student wrote protects it from auto-fill; emptying it hands control back.
            setTitleTouched(v.trim() !== '');
          }}
          error={fieldErrors.title?.[0]}
        />

        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => {
              setRepeat(e.target.checked);
              setRepeatTouched(true);
            }}
            className="size-5"
          />
          <span className="text-sm font-medium">Repetir semanalmente</span>
        </label>

        {repeat ? (
          <SelectField
            id="block-weekday"
            label="Día"
            value={String(weekday)}
            onChange={(v) => setWeekday(Number(v) as Weekday)}
            options={WEEKDAYS.map((d) => ({ value: String(d), label: WEEKDAY_LABELS[d] }))}
            error={fieldErrors.date?.[0]}
          />
        ) : (
          <FormField
            id="block-date"
            label="Fecha"
            type="date"
            value={date}
            onChange={setDate}
            error={fieldErrors.date?.[0]}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            id="block-start"
            label="Inicio"
            type="time"
            value={startTime}
            onChange={setStartTime}
            error={fieldErrors.startTime?.[0]}
          />
          <FormField
            id="block-end"
            label="Fin"
            type="time"
            value={endTime}
            onChange={setEndTime}
            error={fieldErrors.endTime?.[0]}
          />
        </div>

        {repeat && (
          <FormField
            id="block-until"
            label="Hasta"
            type="date"
            value={until}
            onChange={setUntil}
            error={fieldErrors.recurrence?.[0]}
            hint="Por defecto, el fin del periodo académico."
          />
        )}

        {block && repeat && (
          <p className="rounded-md bg-slate-100 p-3 text-sm">{WEEKLY_EDIT_NOTICE}</p>
        )}

        {showWarning && (
          <section
            ref={warningRef}
            role="alert"
            className="rounded-md border border-amber-600 bg-amber-50 p-3 text-sm"
          >
            <p className="font-semibold">⚠ {pending.warnings[0]!.message}</p>
            <ul className="mt-1 list-disc pl-5">
              {pending.warnings.map((w) => (
                <li key={w.with.blockId}>Choca con {describe(w)}</li>
              ))}
            </ul>
            <p className="mt-2">Puedes guardar de todas formas o revisar el horario.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => commit(pending.input)}
                className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
              >
                Guardar de todas formas
              </button>
              <button
                type="button"
                onClick={() => setPending(undefined)}
                className="min-h-11 rounded-md border border-slate-400 bg-white px-4 py-2"
              >
                Revisar horario
              </button>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={save.isPending}
                className="min-h-11 rounded-md border border-red-700 px-4 py-2 text-red-800 disabled:opacity-60"
              >
                Eliminar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={save.isPending}
              className="min-h-11 rounded-md border border-slate-400 px-4 py-2 disabled:opacity-60"
            >
              Cancelar
            </button>
            {!showWarning && (
              <button
                type="submit"
                disabled={save.isPending}
                className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
              >
                {save.isPending ? 'Guardando…' : block ? 'Guardar cambios' : 'Guardar'}
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
