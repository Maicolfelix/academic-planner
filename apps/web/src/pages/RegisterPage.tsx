import { fieldErrorsOf, PASSWORD_MIN_LENGTH, registerSchema } from '@planner/core';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client';
import { useRegister } from '../auth/useAuth';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);

    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) return setFieldErrors(fieldErrorsOf(parsed.error));
    setFieldErrors({});

    register.mutate(parsed.data, {
      onSuccess: () => navigate('/dashboard', { replace: true }),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === 'EMAIL_ALREADY_EXISTS') {
          setFieldErrors({ email: [err.message] });
        } else if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          setFieldErrors(err.fieldErrors);
        } else {
          setFormError(err.message);
        }
      },
    });
  }

  return (
    <AuthLayout title="Crear cuenta">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {formError}
          </p>
        )}
        <FormField
          id="name"
          label="Nombre"
          autoComplete="name"
          value={name}
          onChange={setName}
          error={fieldErrors.name?.[0]}
        />
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password?.[0]}
          hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres.`}
        />
        <button
          type="submit"
          disabled={register.isPending}
          className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {register.isPending ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="text-sm">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium underline">
          Iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
