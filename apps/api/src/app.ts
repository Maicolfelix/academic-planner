import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  checkDatabase: () => Promise<boolean>;
  corsOrigins: string[];
}

export function createApp({ checkDatabase, corsOrigins }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter(checkDatabase));

  app.use(notFoundHandler);
  app.use(createErrorHandler());
  return app;
}
