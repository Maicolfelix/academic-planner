import {
  DEFAULT_TIMEZONE,
  addDays,
  formatDateOnly,
  isRealDateOnly,
  toLocalParts,
  weekRangeOf,
  type ScheduleBlock,
  type ScheduleOccurrence,
} from '@planner/core';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePeriods, useCurrentPeriod } from '../academic/useAcademic';
import { useMe } from '../auth/useAuth';
import { Modal } from '../components/Modal';
import { useIsDesktop } from '../lib/useIsDesktop';
import { useNow } from '../lib/useNow';
import { useSchedule, useScheduleBlock } from '../schedule/useSchedule';
import { BlockFormDialog } from './calendar/BlockFormDialog';
import { DayList } from './calendar/DayList';
import { DeleteBlockDialog } from './calendar/DeleteBlockDialog';
import { WeekGrid } from './calendar/WeekGrid';

const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const secondary =
  'min-h-11 rounded-md border border-slate-400 px-3 py-2 text-sm hover:bg-slate-100';

/** The weekly agenda (Monday–Sunday): a grid on desktop, a day-by-day list on phones. */
export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const timeZone = useMe().data?.timezone ?? DEFAULT_TIMEZONE;
  const now = useNow();
  const isDesktop = useIsDesktop();
  const { period } = useCurrentPeriod();
  const periods = usePeriods().data ?? [];

  // "Today" and the week come from the user's profile timezone, never from the browser's.
  const today = toLocalParts(now, timeZone).date;
  const weekParam = params.get('week');
  const week = weekRangeOf(weekParam && isRealDateOnly(weekParam) ? weekParam : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.from, i));
  const isCurrentWeek = week.from === weekRangeOf(today).from;

  const goTo = (from: string | null) => setParams(from ? { week: from } : {}, { replace: true });

  const schedule = useSchedule(week.from, week.to);
  const occurrences = schedule.data?.occurrences ?? [];

  const [picked, setPicked] = useState<string>();
  const selectedDay =
    picked && days.includes(picked) ? picked : days.includes(today) ? today : week.from;

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ScheduleBlock | null>(null);
  const [notice, setNotice] = useState<string>();

  if (!period) return null; // RequirePeriod guarantees one; keeps the type honest

  const open = (o: ScheduleOccurrence) => setEditing(o.blockId);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-slate-600" aria-live="polite">
            Semana del {formatDateOnly(week.from)} al {formatDateOnly(week.to)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/calendar/import" className={`${secondary} inline-flex items-center`}>
            Importar horario
          </Link>
          <button type="button" onClick={() => setEditing('new')} className={primary}>
            Agregar bloque
          </button>
        </div>
      </header>

      <nav aria-label="Semana" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => goTo(addDays(week.from, -7))} className={secondary}>
          Anterior
        </button>
        <button
          type="button"
          onClick={() => {
            setPicked(undefined);
            goTo(null);
          }}
          disabled={isCurrentWeek}
          className={`${secondary} disabled:opacity-50`}
        >
          Hoy
        </button>
        <button type="button" onClick={() => goTo(addDays(week.from, 7))} className={secondary}>
          Siguiente
        </button>
      </nav>

      {notice && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}

      {schedule.isPending && <p role="status">Cargando agenda…</p>}
      {schedule.isError && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
          <p className="mb-2">No se pudo cargar la agenda: {schedule.error.message}</p>
          <button type="button" onClick={() => schedule.refetch()} className={secondary}>
            Reintentar
          </button>
        </div>
      )}

      {schedule.isSuccess && occurrences.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 p-3 text-slate-700">
          No tienes bloques esta semana. Agrega tus clases y sesiones de estudio con «Agregar
          bloque».
        </p>
      )}

      {schedule.isSuccess &&
        (isDesktop ? (
          <WeekGrid
            days={days}
            occurrences={occurrences}
            timeZone={timeZone}
            today={today}
            onOpen={open}
          />
        ) : (
          <DayList
            days={days}
            selected={selectedDay}
            today={today}
            occurrences={occurrences}
            timeZone={timeZone}
            onSelect={setPicked}
            onOpen={open}
          />
        ))}

      {editing === 'new' && (
        <BlockFormDialog
          periods={periods}
          currentPeriod={period}
          defaultDate={selectedDay}
          timeZone={timeZone}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
          }}
        />
      )}
      {editing && editing !== 'new' && (
        <EditBlock
          id={editing}
          periods={periods}
          currentPeriod={period}
          timeZone={timeZone}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
          }}
          onDelete={(block) => {
            setEditing(null);
            setDeleting(block);
          }}
        />
      )}
      {deleting && (
        <DeleteBlockDialog
          block={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(message) => {
            setDeleting(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

/** Loads the full block (a series is one block) before showing the edit form. */
function EditBlock({
  id,
  onDelete,
  ...rest
}: {
  id: string;
  periods: Parameters<typeof BlockFormDialog>[0]['periods'];
  currentPeriod: Parameters<typeof BlockFormDialog>[0]['currentPeriod'];
  timeZone: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDelete: (block: ScheduleBlock) => void;
}) {
  const block = useScheduleBlock(id);

  if (block.isSuccess) {
    return (
      <BlockFormDialog
        block={block.data}
        defaultDate={block.data.date}
        onDelete={() => onDelete(block.data)}
        {...rest}
      />
    );
  }
  return (
    <Modal title="Editar bloque" onClose={rest.onClose}>
      {block.isPending && <p role="status">Cargando…</p>}
      {block.isError && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          No se pudo cargar el bloque: {block.error.message}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={rest.onClose}
          className="min-h-11 rounded-md border border-slate-400 px-4 py-2"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
