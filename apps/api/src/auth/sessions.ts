import { createHash, randomBytes } from 'node:crypto';
import type { PublicUser } from '@planner/core';
import type { PrismaClient } from '../db/prisma.js';

/** Fixed 7-day lifetime: long enough for a student not to re-login daily, short enough to bound a stolen cookie. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthContext {
  sessionId: string;
  user: PublicUser;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function createSessionService(prisma: PrismaClient) {
  return {
    /** Issues a fresh token (256 bits from the CSPRNG). Only its SHA-256 is persisted. */
    async create(userId: string, now = new Date()) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
      return { token, expiresAt };
    },

    /** cookie token -> hash -> session row -> expiry check -> user. Null when invalid or expired. */
    async resolve(token: string, now = new Date()): Promise<AuthContext | null> {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
        relationLoadStrategy: 'join',
      });
      if (!session) return null;

      if (session.expiresAt <= now) {
        await prisma.session.deleteMany({ where: { id: session.id } });
        return null;
      }
      if (!session.lastUsedAt || now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
        await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
      }

      const { user } = session;
      return {
        sessionId: session.id,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          timezone: user.timezone,
          createdAt: user.createdAt.toISOString(),
        },
      };
    },

    /** Real revocation: the row is deleted, so the token can never resolve again. */
    async revoke(token: string): Promise<void> {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    },

    async purgeExpired(now = new Date()): Promise<void> {
      await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
