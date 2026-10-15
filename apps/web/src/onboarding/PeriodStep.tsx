import { createPeriodSchema, fieldErrorsOf, type PrimaryUse } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { FormField } from '../components/FormField';
import { Button } from '../components/ui/Button';
import { defaultPeriodName } from './onboardingModel';

interface Props {
  primaryUse: PrimaryUse | null;
  pending: boolean;
  /** The server refused or could not be reached. */
  error?: string;
  /** Field errors the server found (they are shown next to their field). */
  serverFieldErrors?: Record<string, string[]>;
  onSubmit: (input: { name: string; startDate: string; endDate: string }) => void;
  /** What the student already wrote (coming back to this step): shown instead of the offered name and empty dates. */
  initial?: { name: string; startDate: string; endDate: string };
}

/**
 * STEP 2: the current period (the app needs one: subjects, activities and the agenda are organised inside it). Name,
 * start and end, nothing else. The name is offered; the dates are NEVER guessed: the student writes them, so they are
 * always what they meant.
 */
export function PeriodStep({
  primaryUse,
  pending,
  error,
  serverFieldErrors,
  onSubmit,
  initial,
}: Props) {
  const [name, setName] = useState(() => initial?.name ?? defaultPeriodName(primaryUse));
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const errors = { ...serverFieldErrors, ...fieldErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createPeriodSchema.safeParse({ name, startDate, endDate });
    if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
    setFieldErrors({});
    onSubmit({
      name: parsed.data.name,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
        >
          {error}
        </p>
      )}
      <FormField
        id="name"
        label="Nombre del periodo"
        value={name}
        onChange={setName}
        error={errors.name?.[0]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="startDate"
          label="Inicio"
          type="date"
          value={startDate}
          onChange={setStartDate}
          error={errors.startDate?.[0]}
        />
        <FormField
          id="endDate"
          label="Fin"
          type="date"
          value={endDate}
          onChange={setEndDate}
          error={errors.endDate?.[0]}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Tus actividades, asignaturas y agenda se organizan dentro de un periodo.
      </p>
      <div>
        <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>
          {pending ? 'Guardando…' : 'Siguiente'}
        </Button>
      </div>
    </form>
  );
}
