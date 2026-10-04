import { fieldErrorsOf, loginSchema } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client';
import { useLogin } from '../auth/useAuth';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';

export function LoginPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
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
      onSuccess: () => navigate('/dashboard', { replace: true }),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          setFieldErrors(err.fieldErrors);
        }
        setFormError(err.message);
      },
    });
  }

  return (
    <AuthLayout title="Iniciar sesión">
      {notice && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
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
          className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="text-sm">
        ¿No tienes cuenta?{' '}
        <Link to="/register" className="font-medium underline">
          Crear cuenta
        </Link>
      </p>
    </AuthLayout>
  );
}
