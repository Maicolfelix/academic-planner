import { createPeriodSchema, fieldErrorsOf } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useCreatePeriod, usePeriods } from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { FullPageMessage } from '../auth/guards';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';
import { LogoutButton } from '../components/LogoutButton';
import { suggestPeriodName } from '../lib/periodName';

/** First-run setup: three fields, then straight to the subjects. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const periods = usePeriods();
  const createPeriod = useCreatePeriod();
  const [name, setName] = useState(suggestPeriodName);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  if (periods.isPending) return <FullPageMessage>Cargando…</FullPageMessage>;
  // Already configured: nothing to do here.
  if (periods.data?.some((p) => p.isCurrent)) return <Navigate to="/subjects" replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);

    const parsed = createPeriodSchema.safeParse({ name, startDate, endDate });
    if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
    setFieldErrors({});

    createPeriod.mutate(parsed.data, {
      onSuccess: () => navigate('/subjects', { replace: true }),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          setFieldErrors(err.fieldErrors);
        }
        setFormError(err.message);
      },
    });
  }

  return (
    <AuthLayout title="Configuremos tu semestre">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {formError}
          </p>
        )}
        <FormField
          id="name"
          label="Nombre del periodo"
          value={name}
          onChange={setName}
          error={fieldErrors.name?.[0]}
        />
        <FormField
          id="startDate"
          label="Inicio"
          type="date"
          value={startDate}
          onChange={setStartDate}
          error={fieldErrors.startDate?.[0]}
        />
        <FormField
          id="endDate"
          label="Fin"
          type="date"
          value={endDate}
          onChange={setEndDate}
          error={fieldErrors.endDate?.[0]}
        />
        <button
          type="submit"
          disabled={createPeriod.isPending}
          className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {createPeriod.isPending ? 'Guardando…' : 'Continuar'}
        </button>
      </form>
      <div>
        <LogoutButton className="-ml-3" />
      </div>
    </AuthLayout>
  );
}
