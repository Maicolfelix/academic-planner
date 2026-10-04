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
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  className = '',
}: SelectFieldProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`min-h-11 w-full rounded-md border bg-white px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 focus:outline-slate-900 ${
          error ? 'border-red-600' : 'border-slate-400'
        }`}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
