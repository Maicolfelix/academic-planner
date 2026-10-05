import { loginSchema, registerSchema, type AuthResponse } from '@planner/core';
import { Router, type Request, type RequestHandler } from 'express';
import type { AuthService } from '../auth/authService.js';
import { clearSessionCookie, sessionTokenOf, setSessionCookie } from '../auth/cookies.js';
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

  // Signing in (or up) always issues a NEW token; the one the browser was holding, if any, is revoked on the spot
  // so it cannot linger as a second valid session (and nothing a client sends is ever reused as a session).
  const retire = async (req: Request) => {
    const previous = sessionTokenOf(req, secureCookies);
    if (previous) await sessions.revoke(previous);
  };

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
      await retire(req);
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
      await retire(req);
      setSessionCookie(res, session.token, secureCookies);
      res.json({ user } satisfies AuthResponse);
    },
  );

  // Idempotent: logging out without a valid session is still a success.
  router.post('/logout', async (req, res) => {
    const token = sessionTokenOf(req, secureCookies);
    if (token) await sessions.revoke(token);
    clearSessionCookie(res, secureCookies);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: authOf(req).user } satisfies AuthResponse);
  });

  return router;
}
