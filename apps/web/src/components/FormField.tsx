import { fieldControl, FIELD_LABEL } from './ui/fieldStyles';
import { FieldError } from './ui/form';

interface FormFieldProps {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'date' | 'time';
  /** Renders a textarea instead of an input. */
  multiline?: boolean;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  /** Announces the field as required to assistive technology (the form validates; nothing is drawn). */
  required?: boolean;
  disabled?: boolean;
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
  value,
  onChange,
  error,
  hint,
  required,
  disabled,
}: FormFieldProps) {
  const showHint = Boolean(hint) && !error;
  const describedBy = [error && `${id}-error`, showHint && `${id}-hint`].filter(Boolean).join(' ');
  const shared = {
    id,
    name: id,
    value,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: fieldControl(Boolean(error)),
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...shared}
          type={type}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
        />
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
