import { z } from 'zod';

/**
 * Password policy: length over composition (NIST SP 800-63B). Minimum 8, no mandatory symbols/digits.
 * Maximum 128 only bounds Argon2 hashing cost. Passwords are never trimmed or altered.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Trimmed + lowercased, so the stored value is already normalised. */
export const emailSchema = z
  .string({ error: 'Ingresa tu correo.' })
  .trim()
  .toLowerCase()
  .max(254, 'El correo es demasiado largo.')
  .pipe(z.email('Ingresa un correo válido.'));

export const registerSchema = z.strictObject({
  name: z
    .string({ error: 'Ingresa tu nombre.' })
    .trim()
    .min(1, 'Ingresa tu nombre.')
    .max(80, 'El nombre es demasiado largo (máximo 80 caracteres).'),
  email: emailSchema,
  password: z
    .string({ error: 'Ingresa una contraseña.' })
    .min(
      PASSWORD_MIN_LENGTH,
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    )
    .max(PASSWORD_MAX_LENGTH, `La contraseña es demasiado larga (máximo ${PASSWORD_MAX_LENGTH}).`),
});

/** Login does not enforce the registration policy: it must not hint at it. */
// Not strict on purpose: signing in assigns nothing from the body, it only reads email and password.
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Ingresa tu contraseña.' })
    .min(1, 'Ingresa tu contraseña.')
    .max(PASSWORD_MAX_LENGTH, 'Correo o contraseña incorrectos.'),
});

export const publicUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  timezone: z.string(),
  createdAt: z.iso.datetime(),
});

export const authResponseSchema = z.object({ user: publicUserSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
