import {
  DEFAULT_TIMEZONE,
  isRealDateOnly,
  toLocalParts,
  weekdayOf,
  type DateOnly,
} from '@planner/core';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useMe } from '../../auth/useAuth';
import { useNow } from '../../lib/useNow';
import { CalendarIcon, PIXELS, PixelIcon } from './icons';
import { firstOfMonth, MONTH_NAMES, monthGrid, shiftMonth } from './monthGrid';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** The label a screen reader reads for a day: "miércoles 28 de octubre de 2026". */
function dayLabel(d: DateOnly): string {
  const name = WEEKDAY_NAMES[weekdayOf(d) - 1];
  return `${name} ${Number(d.slice(8, 10))} de ${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
}

/**
 * Writes a date into the NATIVE input as if the student had typed it: the value goes through the browser's own setter and an
 * `input` event bubbles, so React's `onChange` and the dialog's "unsaved changes" watch see it like any other edit.
 */
function writeToInput(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The month on a card of the app's own: pixel arrows, the week from Monday, today ringed in teal, the chosen day lit in indigo,
 * and "Hoy" / "Borrar". Keyboard: arrows move by a day or a week, Page Up / Page Down by a month, Home / End to the ends of the
 * row, Enter or Space choose, Escape closes. It only exists while it is open (so it can read the student's time zone).
 */
function CalendarPopup({
  value,
  upward,
  onPick,
  onClose,
}: {
  value: string;
  upward: boolean;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const timeZone = useMe().data?.timezone ?? DEFAULT_TIMEZONE;
  const now = useNow();
  const today = toLocalParts(now, timeZone).date;
  const chosen = isRealDateOnly(value) ? value : undefined;
  const [view, setView] = useState<DateOnly>(firstOfMonth(chosen ?? today));
  const viewYear = Number(view.slice(0, 4));
  const todayYear = Number(today.slice(0, 4));
  const years = Array.from(
    { length: Math.max(todayYear + 10, viewYear) - Math.min(todayYear - 10, viewYear) + 1 },
    (_, i) => Math.min(todayYear - 10, viewYear) + i,
  );
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const pickingYear = mode === 'years';
  const viewMonth = Number(view.slice(5, 7));
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus lands on the chosen day, or today, or the first day of the month: wherever the student would expect to start.
  useEffect(() => {
    const target =
      grid.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      grid.current?.querySelector<HTMLElement>('[aria-current="date"]') ??
      grid.current?.querySelector<HTMLElement>('button');
    target?.focus();
  }, [view, mode]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      // Not the dialog's: Escape closes this card first, and the form behind it stays as it is.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      setView(shiftMonth(view, e.key === 'PageUp' ? -1 : 1));
      return;
    }
    const cols = mode === 'days' ? 7 : mode === 'months' ? 3 : 4;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    const days = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = days.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    if (step !== undefined) {
      e.preventDefault();
      days[Math.min(days.length - 1, Math.max(0, at + step))]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const row = Math.floor(at / cols) * cols;
      days[e.key === 'Home' ? row : Math.min(days.length - 1, row + cols - 1)]?.focus();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Elegir fecha"
      onKeyDown={onKeyDown}
      className={`absolute right-0 z-40 w-[18.5rem] max-w-[calc(100vw-2rem)] animate-dialog overflow-hidden rounded-surface border border-border bg-surface-elevated p-3 text-foreground shadow-floating ${
        upward ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
      }`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--accent),var(--primary))]"
      />
      <div className="mb-2 flex items-center justify-between gap-1 pt-1">
        <button
          type="button"
          aria-label={mode === 'months' ? 'Año anterior' : 'Mes anterior'}
          onClick={() => setView(shiftMonth(view, mode === 'months' ? -12 : -1))}
          className="grid size-11 place-items-center rounded-full text-primary transition-colors duration-(--duration-fast) hover:bg-secondary"
        >
          <PixelIcon rows={PIXELS.left} className="size-5" />
        </button>
        <p id={titleId} aria-live="polite" className="flex items-center gap-1 text-card-title">
          <button
            type="button"
            aria-expanded={mode === 'months'}
            aria-label={`${MONTH_NAMES[viewMonth - 1]}. Elegir mes`}
            onClick={() => setMode(mode === 'months' ? 'days' : 'months')}
            className="min-h-11 rounded-control px-2 capitalize transition-colors duration-(--duration-fast) hover:bg-secondary"
          >
            {MONTH_NAMES[viewMonth - 1]}
          </button>
          <button
            type="button"
            aria-expanded={pickingYear}
            aria-label={`${viewYear}. Elegir año`}
            onClick={() => setMode(pickingYear ? 'days' : 'years')}
            className="min-h-11 rounded-control px-2 tabular-nums transition-colors duration-(--duration-fast) hover:bg-secondary"
          >
            {viewYear}
          </button>
        </p>
        <button
          type="button"
          aria-label={mode === 'months' ? 'Año siguiente' : 'Mes siguiente'}
          onClick={() => setView(shiftMonth(view, mode === 'months' ? 12 : 1))}
          className="grid size-11 place-items-center rounded-full text-primary transition-colors duration-(--duration-fast) hover:bg-secondary"
        >
          <PixelIcon rows={PIXELS.right} className="size-5" />
        </button>
      </div>

      {mode === 'months' && (
        <div ref={grid} role="group" aria-label="Mes" className="grid grid-cols-3 gap-1 py-1">
          {MONTH_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              aria-pressed={i + 1 === viewMonth}
              onClick={() => {
                setView(`${view.slice(0, 5)}${String(i + 1).padStart(2, '0')}-01` as DateOnly);
                setMode('days');
              }}
              className={`min-h-11 rounded-xl text-sm font-medium capitalize transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                i + 1 === viewMonth
                  ? 'bg-primary text-primary-foreground shadow-[2px_2px_0_0_var(--accent)]'
                  : 'hover:bg-secondary'
              }`}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      )}
      {pickingYear && (
        <div
          ref={grid}
          role="group"
          aria-label="Año"
          className="grid max-h-[12rem] grid-cols-4 gap-1 overflow-y-auto py-1"
        >
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={y === viewYear}
              ref={(el) => {
                if (el && y === viewYear) {
                  const box = el.parentElement!; // scroll the list only, never the page behind
                  box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 2;
                }
              }}
              onClick={() => {
                setView(`${y}-${view.slice(5, 7)}-01` as DateOnly);
                setMode('days');
              }}
              className={`min-h-11 rounded-xl text-sm font-medium tabular-nums transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                y === viewYear
                  ? 'bg-primary text-primary-foreground shadow-[2px_2px_0_0_var(--accent)]'
                  : y === todayYear
                    ? 'bg-accent-soft font-semibold text-accent-ink ring-2 ring-accent/60'
                    : 'hover:bg-secondary'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}
      {mode === 'days' && (
        <>
          <div
            aria-hidden="true"
            className="grid grid-cols-7 pb-1 text-center text-xs font-semibold text-muted-foreground"
          >
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div
            ref={grid}
            role="group"
            aria-labelledby={titleId}
            className="grid grid-cols-7 gap-y-0.5"
          >
            {monthGrid(view)
              .flat()
              .map((d, i) =>
                d ? (
                  <button
                    key={d}
                    type="button"
                    aria-label={dayLabel(d)}
                    aria-pressed={d === chosen}
                    aria-current={d === today ? 'date' : undefined}
                    onClick={() => onPick(d)}
                    className={`mx-auto grid size-10 place-items-center rounded-xl text-sm font-medium tabular-nums transition-[transform,background-color,box-shadow] duration-(--duration-fast) ease-spring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:scale-90 ${
                      d === chosen
                        ? 'bg-primary text-primary-foreground shadow-[2px_2px_0_0_var(--accent)]'
                        : d === today
                          ? 'bg-accent-soft font-semibold text-accent-ink ring-2 ring-accent/60 hover:bg-accent/15'
                          : 'hover:bg-secondary'
                    }`}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                ) : (
                  <span key={`b${i}`} aria-hidden="true" />
                ),
              )}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-dashed border-border-strong/40 pt-2 text-sm font-semibold">
        <button
          type="button"
          onClick={() => onPick('')}
          className="min-h-11 rounded-control px-3 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Borrar
        </button>
        <button
          type="button"
          onClick={() => onPick(today)}
          className="min-h-11 rounded-control px-3 text-accent-ink hover:bg-accent-soft"
        >
          Hoy
        </button>
      </div>
    </div>
  );
}

/**
 * The calendar button that sits on the right of a date field, and the card it opens. The field underneath is still the NATIVE
 * `<input type="date">` (it can be typed, and a phone keeps its own picker); this button only appears with a mouse or a trackpad,
 * where the browser's grey picker is the least at home.
 */
export function DatePickerButton({
  inputRef,
  value,
  labelId,
  disabled,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  /** The id of the field's label: it is the button's description (its NAME stays generic so the field is found by its label alone). */
  labelId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function toggle() {
    if (!open) {
      // Open upward when there is little room below the field and more above it.
      const rect = box.current?.getBoundingClientRect();
      if (rect)
        setUpward(
          window.innerHeight - rect.bottom < 380 && rect.top > window.innerHeight - rect.bottom,
        );
    }
    setOpen(!open);
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div ref={box} className="absolute top-0 right-0">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label="Abrir calendario"
        aria-describedby={labelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="grid size-11 place-items-center rounded-control text-primary transition-colors duration-(--duration-fast) hover:text-accent-ink disabled:opacity-50"
      >
        <CalendarIcon />
      </button>
      {open && (
        <CalendarPopup
          value={value}
          upward={upward}
          onPick={(v) => {
            writeToInput(inputRef.current, v);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
