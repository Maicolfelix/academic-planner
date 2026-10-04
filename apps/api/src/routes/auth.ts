import { loginSchema, registerSchema, type AuthResponse } from '@planner/core';
import { Router, type RequestHandler } from 'express';
import type { AuthService } from '../auth/authService.js';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../auth/cookies.js';
import type { SessionService } from '../auth/sessions.js';
import {
  createLimiter,
  LOGIN_WINDOW_MS,
  REGISTER_WINDOW_MS,
  type AuthRateLimits,
} from '../middleware/rateLimit.js';
import { authOf } from '../middleware/requireAuth.js';

interface Deps {
  auth: AuthService;
  sessions: SessionService;
  requireAuth: RequestHandler;
  secureCookies: boolean;
  rateLimits: AuthRateLimits;
}

export function authRouter({
  auth,
  sessions,
  requireAuth,
  secureCookies,
  rateLimits,
}: Deps): Router {
  const router = Router();

  // Credentials and sessions must never be cached by browsers or proxies.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post(
    '/register',
    createLimiter({ windowMs: REGISTER_WINDOW_MS, limit: rateLimits.registerMax }),
    async (req, res) => {
      const input = registerSchema.parse(req.body ?? {});
      const { user, session } = await auth.register(input);
      setSessionCookie(res, session.token, secureCookies);
      res.status(201).json({ user } satisfies AuthResponse);
    },
  );

  router.post(
    '/login',
    createLimiter({ windowMs: LOGIN_WINDOW_MS, limit: rateLimits.loginMax, onlyFailures: true }),
    async (req, res) => {
      const input = loginSchema.parse(req.body ?? {});
      const { user, session } = await auth.login(input);
      setSessionCookie(res, session.token, secureCookies);
      res.json({ user } satisfies AuthResponse);
    },
  );

  // Idempotent: logging out without a valid session is still a success.
  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0 && token.length <= 128) {
      await sessions.revoke(token);
    }
    clearSessionCookie(res, secureCookies);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: authOf(req).user } satisfies AuthResponse);
  });

  return router;
}
