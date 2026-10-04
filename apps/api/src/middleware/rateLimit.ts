import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/AppError.js';

export interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Count only failed responses (status >= 400), so honest users are never throttled. */
  onlyFailures?: boolean;
}

// In-memory store, keyed by client IP: per-process only. See docs/auth.md for the limits of this.
export const createLimiter = ({ windowMs, limit, onlyFailures = false }: LimiterOptions) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: onlyFailures,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Demasiados intentos. Inténtalo de nuevo más tarde.')),
  });

export interface AuthRateLimits {
  loginMax: number;
  registerMax: number;
}

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
