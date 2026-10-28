import { fieldErrorsOf, loginSchema, safeReturnTo } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client';
import { useLogin } from '../auth/useAuth';
import { AuthLayout, type AuthMood } from '../components/AuthLayout';
import { AuthNotice } from '../components/auth/AuthNotice';
import { buttonStyles } from '../components/ui/buttonStyles';
import { EnterIcon, LockIcon } from '../components/ui/icons';
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
    <AuthLayout
      title="Iniciar sesión"
      icon={<LockIcon />}
      intro="Hola otra vez. Qué bueno verte."
      mood={mood}
    >
      {warning && (
        <AuthNotice tone="warning" role="status">
          {warning}
        </AuthNotice>
      )}
      {notice && (
        <AuthNotice tone="success" role="status">
          {notice}
        </AuthNotice>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <AuthNotice tone="danger" role="alert">
            {formError}
          </AuthNotice>
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
          className={buttonStyles({ variant: 'primary', className: 'w-full gap-2' })}
        >
          {login.isPending ? 'Entrando…' : 'Entrar'}
          {!login.isPending && <EnterIcon className="size-5" />}
        </button>
      </form>
      <p className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border-strong/50 pt-4 text-sm">
        <span>¿No tienes cuenta?</span>
        <Link
          to="/register"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-4 font-semibold text-accent-ink transition-transform duration-(--duration-fast) ease-standard hover:-translate-y-px"
        >
          Crear cuenta
          <EnterIcon className="size-4" />
        </Link>
      </p>
    </AuthLayout>
  );
}
