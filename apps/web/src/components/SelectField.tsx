import { fieldControl, FIELD_LABEL } from './ui/fieldStyles';
import { FieldError } from './ui/form';
import { ChevronDownIcon } from './ui/icons';

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** Adds a first, empty option (e.g. "Todas" for filters or "Elige…" for required fields). */
  placeholder?: string;
  error?: string;
  /** Extra classes for the wrapper (e.g. grid spans). */
  className?: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * A labelled NATIVE `<select>` (the best picker on every phone: Safari on iPhone still opens its own wheel). Only its dress
 * changes: the browser's arrow is replaced by a chevron of ours (decoration, it never catches a tap), an unchosen
 * placeholder reads as such, and the error is said in words with an icon.
 */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  className = '',
  required,
  disabled,
}: SelectFieldProps) {
  const unchosen = placeholder !== undefined && value === '';
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <span className="relative block">
        <select
          id={id}
          name={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${fieldControl(Boolean(error))} cursor-pointer appearance-none pr-10 ${
            unchosen ? 'text-muted-foreground' : ''
          }`}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} className="text-foreground">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
