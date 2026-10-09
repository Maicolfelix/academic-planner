import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreIcon } from './icons';

export interface ActionMenuItem {
  /** What is read and shown: "Añadir al calendario". */
  label: string;
  /** The accessible name when the visible label is not enough on its own: "Eliminar Parcial 1". */
  ariaLabel?: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** A destructive action: shown in the danger color, never the first or the default one. */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The secondary actions of a card behind one button. A small, native-feeling menu (no library):
 * - the trigger is a real `<button>` with `aria-haspopup="menu"` and `aria-expanded`; its accessible name says WHICH
 *   card it belongs to ("Más acciones: Parcial 1");
 * - Enter, Space and ArrowDown open it and put the focus on the first item; ArrowUp opens it on the last one;
 *   inside, the arrows, Home and End move between the items, Escape closes it and gives the focus back to the trigger,
 *   and Tab simply leaves (closing it);
 * - a click anywhere else closes it; choosing an item closes it and puts the focus on the trigger BEFORE the action runs,
 *   so a dialog opened by the action returns the focus to a button that still exists;
 * - it opens below the trigger, or above it when the bottom of the screen (and the phone's bar) is too close.
 * Items are 44 px tall.
 */
export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAt = useRef<'first' | 'last'>('first');
  const menuId = useId();

  // When it opens, the focus goes inside (first or last item, depending on how it was opened).
  useEffect(() => {
    if (!open) return;
    const enabled = itemRefs.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled);
    (focusAt.current === 'last' ? enabled.at(-1) : enabled[0])?.focus();
  }, [open]);

  // Outside click or touch closes it.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const openMenu = (at: 'first' | 'last') => {
    const rect = trigger.current?.getBoundingClientRect();
    // 190 px = the menu (about 3 items) plus the phone's bottom bar: below that, open upward.
    setUp(rect ? window.innerHeight - rect.bottom < 190 : false);
    focusAt.current = at;
    setOpen(true);
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu('last');
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const enabled = itemRefs.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled);
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      enabled[(to + enabled.length) % enabled.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(enabled.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // a dialog around the card must not also close
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu('first'))}
        onKeyDown={onTriggerKey}
        className="grid size-11 place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-(--duration-fast) ease-standard hover:bg-secondary hover:text-foreground active:scale-95 aria-expanded:bg-secondary aria-expanded:text-foreground"
      >
        <MoreIcon />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`absolute right-0 z-20 flex min-w-56 animate-rise flex-col rounded-surface border border-border bg-surface p-1 shadow-floating ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              aria-label={item.ariaLabel}
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                item.onSelect();
              }}
              className={`flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-left text-sm font-medium transition-colors duration-(--duration-fast) ease-standard hover:bg-secondary focus-visible:bg-secondary disabled:opacity-60 ${
                item.danger ? 'text-danger' : 'text-foreground'
              }`}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
