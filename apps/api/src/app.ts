import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthService } from './auth/authService.js';
import { createSessionService } from './auth/sessions.js';
import { transactionRunner, type PrismaClient } from './db/prisma.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { originCheck } from './middleware/originCheck.js';
import type { AuthRateLimits } from './middleware/rateLimit.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createActivityController } from './controllers/activityController.js';
import { createAttentionController } from './controllers/attentionController.js';
import { createDashboardController } from './controllers/dashboardController.js';
import {
  createProgressController,
  createWorkloadController,
} from './controllers/insightsController.js';
import { createPeriodController } from './controllers/periodController.js';
import { createRadarController } from './controllers/radarController.js';
import { createReminderController } from './controllers/reminderController.js';
import { createScheduleController } from './controllers/scheduleController.js';
import { createSubjectController } from './controllers/subjectController.js';
import { createActivityRepository } from './repositories/activityRepository.js';
import { createDashboardRepository } from './repositories/dashboardRepository.js';
import { createInsightsRepository } from './repositories/insightsRepository.js';
import { createPeriodRepository } from './repositories/periodRepository.js';
import { createRadarRepository } from './repositories/radarRepository.js';
import { createReminderRepository } from './repositories/reminderRepository.js';
import { createScheduleRepository } from './repositories/scheduleRepository.js';
import { createSubjectRepository } from './repositories/subjectRepository.js';
import { activitiesRouter } from './routes/activities.js';
import { attentionRouter } from './routes/attention.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { healthRouter } from './routes/health.js';
import { progressRouter, workloadRouter } from './routes/insights.js';
import { periodsRouter } from './routes/periods.js';
import { radarRouter } from './routes/radar.js';
import { remindersRouter } from './routes/reminders.js';
import { scheduleRouter } from './routes/schedule.js';
import { subjectsRouter } from './routes/subjects.js';
import { createActivityService } from './services/activityService.js';
import { createAttentionService } from './services/attentionService.js';
import { createDashboardService } from './services/dashboardService.js';
import { createPeriodService } from './services/periodService.js';
import { createProgressService } from './services/progressService.js';
import { createRadarService } from './services/radarService.js';
import { createReminderService } from './services/reminderService.js';
import { createScheduleService } from './services/scheduleService.js';
import { createWorkloadService } from './services/workloadService.js';
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

  const runInTransaction = transactionRunner(prisma);
  const subjectRepository = createSubjectRepository(prisma);
  const periodRepository = createPeriodRepository(prisma);
  const activityRepository = createActivityRepository(prisma);
  const activityController = createActivityController(
    createActivityService(activityRepository, subjectRepository, clock, runInTransaction),
  );
  const reminderController = createReminderController(
    createReminderService(
      createReminderRepository(prisma),
      activityRepository,
      periodRepository,
      runInTransaction,
      clock,
    ),
  );
  const scheduleRepository = createScheduleRepository(prisma);
  const dashboardController = createDashboardController(
    createDashboardService(createDashboardRepository(prisma), scheduleRepository, clock),
  );
  const insightsRepository = createInsightsRepository(prisma);
  const progressController = createProgressController(
    createProgressService(insightsRepository, periodRepository, clock),
  );
  const workloadController = createWorkloadController(
    createWorkloadService(insightsRepository, scheduleRepository, periodRepository, clock),
  );
  const radarRepository = createRadarRepository(prisma);
  const radarController = createRadarController(
    createRadarService(radarRepository, periodRepository, clock),
  );
  const attentionController = createAttentionController(
    createAttentionService(radarRepository, periodRepository, clock),
  );
  const scheduleController = createScheduleController(
    createScheduleService(scheduleRepository, periodRepository, subjectRepository, clock),
  );
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
  app.use('/api/radar', radarRouter(radarController, requireAuth));
  app.use('/api/progress', progressRouter(progressController, requireAuth));
  app.use('/api/workload', workloadRouter(workloadController, requireAuth));
  app.use('/api/attention', attentionRouter(attentionController, requireAuth));
  app.use('/api/schedule', scheduleRouter(scheduleController, requireAuth));
  app.use('/api/reminders', remindersRouter(reminderController, requireAuth));

  app.use(notFoundHandler);
  app.use(createErrorHandler());
  return app;
}
