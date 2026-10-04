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
}

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
}: FormFieldProps) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ');
  const shared = {
    id,
    name: id,
    value,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: `w-full rounded-md border px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 focus:outline-slate-900 ${
      error ? 'border-red-600' : 'border-slate-400'
    }`,
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
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
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
