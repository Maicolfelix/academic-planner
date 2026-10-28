import { useRef, useSyncExternalStore } from 'react';
import { DatePickerButton } from './ui/DatePicker';
import { fieldControl, FIELD_LABEL } from './ui/fieldStyles';
import { FieldError } from './ui/form';

interface FormFieldProps {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'date' | 'time';
  /** Renders a textarea instead of an input. */
  multiline?: boolean;
  autoComplete?: string;
  /** The keyboard a phone shows (numbers only, for instance). */
  inputMode?: 'numeric' | 'decimal' | 'text' | 'search';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Stops typing at this length (the server's own limit), so nothing typed is cut afterwards. */
  maxLength?: number;
  error?: string;
  hint?: string;
  /** Announces the field as required to assistive technology (the form validates; nothing is drawn). */
  required?: boolean;
  disabled?: boolean;
}

/** A mouse or a trackpad (not a finger): where the app's own calendar replaces the browser's grey one. Off while rendering on a server. */
function usePointerFine(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia('(pointer: fine)');
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(pointer: fine)').matches,
    () => false,
  );
}

/**
 * A labelled NATIVE input (or textarea, date or time picker): label above, the control, then a hint or an error. The
 * error is linked with `aria-describedby`, marks the field `aria-invalid` and says it in words with an icon. A hint is
 * only linked while it is shown (it gives way to an error).
 */
export function FormField({
  id,
  label,
  type = 'text',
  multiline = false,
  autoComplete,
  inputMode,
  value,
  onChange,
  placeholder,
  maxLength,
  error,
  hint,
  required,
  disabled,
}: FormFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerFine = usePointerFine();
  const ownCalendar = type === 'date' && pointerFine && !disabled;
  const showHint = Boolean(hint) && !error;
  const describedBy = [error && `${id}-error`, showHint && `${id}-hint`].filter(Boolean).join(' ');
  const shared = {
    id,
    name: id,
    value,
    disabled,
    placeholder,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: `${fieldControl(Boolean(error))}${ownCalendar ? ' date-own pr-11' : ''}`,
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} id={`${id}-label`} className={FIELD_LABEL}>
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="relative">
          <input
            {...shared}
            ref={inputRef}
            type={type}
            autoComplete={autoComplete}
            inputMode={inputMode}
            onChange={(e) => onChange(e.target.value)}
          />
          {ownCalendar && (
            <DatePickerButton
              inputRef={inputRef}
              value={value}
              labelId={`${id}-label`}
              disabled={disabled}
            />
          )}
        </div>
      )}
      {showHint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
