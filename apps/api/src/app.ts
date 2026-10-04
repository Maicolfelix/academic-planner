import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthService } from './auth/authService.js';
import { createSessionService } from './auth/sessions.js';
import type { PrismaClient } from './db/prisma.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { originCheck } from './middleware/originCheck.js';
import type { AuthRateLimits } from './middleware/rateLimit.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  prisma: PrismaClient;
  checkDatabase: () => Promise<boolean>;
  corsOrigins: string[];
  /** `Secure` cookie attribute; true in production (HTTPS). */
  secureCookies: boolean;
  rateLimits: AuthRateLimits;
}

export function createApp(deps: AppDeps): Express {
  const { prisma, checkDatabase, corsOrigins, secureCookies, rateLimits } = deps;
  const sessions = createSessionService(prisma);
  const auth = createAuthService(prisma, sessions);
  const requireAuth = createRequireAuth(sessions, secureCookies);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', originCheck(corsOrigins));

  app.use('/api/health', healthRouter(checkDatabase));
  app.use('/api/auth', authRouter({ auth, sessions, requireAuth, secureCookies, rateLimits }));

  app.use(notFoundHandler);
  app.use(createErrorHandler());
  return app;
}
