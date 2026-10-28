import { fieldErrorsOf, loginSchema, safeReturnTo } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client';
import { useLogin } from '../auth/useAuth';
import { AuthLayout, type AuthMood } from '../components/AuthLayout';
import { buttonStyles } from '../components/ui/buttonStyles';
import { FormField } from '../components/FormField';

export function LoginPage() {
  const navigate = useNavigate();
  const state = useLocation().state as { notice?: string; warning?: string; from?: unknown } | null;
  const notice = state?.notice;
  const warning = state?.warning;
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
    setFieldErrors({});

    login.mutate(parsed.data, {
      onSuccess: () => navigate(safeReturnTo(state?.from) ?? '/dashboard', { replace: true }),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          setFieldErrors(err.fieldErrors);
        }
        setFormError(err.message);
      },
    });
  }

  const mood: AuthMood = login.isPending
    ? 'pending'
    : login.isSuccess
      ? 'success'
      : formError || Object.keys(fieldErrors).length > 0
        ? 'error'
        : 'idle';

  return (
    <AuthLayout title="Iniciar sesión" intro="Hola otra vez. Qué bueno verte." mood={mood}>
      {warning && (
        <p
          role="status"
          className="rounded-control border border-warning-line bg-warning-soft p-3 text-sm text-warning-ink"
        >
          {warning}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-control border border-success-line bg-success-soft p-3 text-sm text-success-ink"
        >
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
          >
            {formError}
          </p>
        )}
        <FormField
          id="email"
          label="Correo"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email?.[0]}
        />
        <FormField
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password?.[0]}
        />
        <button
          type="submit"
          disabled={login.isPending}
          className={buttonStyles({ variant: 'primary', className: 'w-full' })}
        >
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="text-sm">
        ¿No tienes cuenta?{' '}
        <Link to="/register" className="font-medium text-accent-ink underline underline-offset-4">
          Crear cuenta
        </Link>
      </p>
    </AuthLayout>
  );
}
