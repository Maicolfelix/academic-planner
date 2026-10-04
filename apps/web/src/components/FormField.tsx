interface FormFieldProps {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password';
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
  autoComplete,
  value,
  onChange,
  error,
  hint,
}: FormFieldProps) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-md border px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 focus:outline-slate-900 ${
          error ? 'border-red-600' : 'border-slate-400'
        }`}
      />
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
