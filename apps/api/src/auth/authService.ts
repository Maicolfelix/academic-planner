import type { LoginInput, PublicUser, RegisterInput } from '@planner/core';
import type { PrismaClient } from '../db/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../errors/AppError.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';
import type { SessionService } from './sessions.js';

type DbUser = { id: string; name: string; email: string; timezone: string; createdAt: Date };

export const toPublicUser = (u: DbUser): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  timezone: u.timezone,
  createdAt: u.createdAt.toISOString(),
});

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');

export function createAuthService(prisma: PrismaClient, sessions: SessionService) {
  return {
    async register(input: RegisterInput) {
      const passwordHash = await hashPassword(input.password);
      let user;
      try {
        user = await prisma.user.create({
          data: { name: input.name, email: input.email, passwordHash },
        });
      } catch (err) {
        // The unique index is the source of truth, so concurrent duplicates are also caught.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Ya existe una cuenta con este correo.');
        }
        throw err;
      }
      const session = await sessions.create(user.id);
      return { user: toPublicUser(user), session };
    },

    async login(input: LoginInput) {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user) {
        await verifyAgainstDummy(input.password);
        throw invalidCredentials();
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();

      await sessions.purgeExpired();
      const session = await sessions.create(user.id);
      return { user: toPublicUser(user), session };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
