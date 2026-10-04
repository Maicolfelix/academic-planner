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
import { createActivityController } from './controllers/activityController.js';
import { createDashboardController } from './controllers/dashboardController.js';
import { createPeriodController } from './controllers/periodController.js';
import { createSubjectController } from './controllers/subjectController.js';
import { createActivityRepository } from './repositories/activityRepository.js';
import { createDashboardRepository } from './repositories/dashboardRepository.js';
import { createPeriodRepository } from './repositories/periodRepository.js';
import { createSubjectRepository } from './repositories/subjectRepository.js';
import { activitiesRouter } from './routes/activities.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { healthRouter } from './routes/health.js';
import { periodsRouter } from './routes/periods.js';
import { subjectsRouter } from './routes/subjects.js';
import { createActivityService } from './services/activityService.js';
import { createDashboardService } from './services/dashboardService.js';
import { createPeriodService } from './services/periodService.js';
import { createSubjectService } from './services/subjectService.js';

export interface AppDeps {
  prisma: PrismaClient;
  checkDatabase: () => Promise<boolean>;
  corsOrigins: string[];
  /** `Secure` cookie attribute; true in production (HTTPS). */
  secureCookies: boolean;
  rateLimits: AuthRateLimits;
  /** Source of "now" for rules that depend on it (overdue filter, completedAt). Defaults to the real clock. */
  clock?: () => Date;
}

export function createApp(deps: AppDeps): Express {
  const { prisma, checkDatabase, corsOrigins, secureCookies, rateLimits } = deps;
  const clock = deps.clock ?? (() => new Date());
  const sessions = createSessionService(prisma);
  const auth = createAuthService(prisma, sessions);
  const requireAuth = createRequireAuth(sessions, secureCookies);

  const subjectRepository = createSubjectRepository(prisma);
  const activityController = createActivityController(
    createActivityService(createActivityRepository(prisma), subjectRepository, clock),
  );
  const dashboardController = createDashboardController(
    createDashboardService(createDashboardRepository(prisma), clock),
  );
  const periodRepository = createPeriodRepository(prisma);
  const periodController = createPeriodController(createPeriodService(periodRepository));
  const subjectController = createSubjectController(
    createSubjectService(subjectRepository, periodRepository),
  );

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', originCheck(corsOrigins));

  app.use('/api/health', healthRouter(checkDatabase));
  app.use('/api/auth', authRouter({ auth, sessions, requireAuth, secureCookies, rateLimits }));

  app.use('/api/periods', periodsRouter(periodController, requireAuth));
  app.use('/api/subjects', subjectsRouter(subjectController, requireAuth));
  app.use('/api/activities', activitiesRouter(activityController, requireAuth));
  app.use('/api/dashboard', dashboardRouter(dashboardController, requireAuth));

  app.use(notFoundHandler);
  app.use(createErrorHandler());
  return app;
}
