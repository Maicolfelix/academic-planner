import { apiErrorSchema, authResponseSchema } from '@planner/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApp,
  credentials,
  ORIGIN,
  prisma,
  resetDb,
  sessionCookie,
  tokenFrom,
} from '../../test/helpers.js';
import { hashToken, SESSION_TTL_MS } from './sessions.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const register = (body: object = credentials) => request(app).post('/api/auth/register').send(body);
const login = (body: object) => request(app).post('/api/auth/login').send(body);

describe('POST /api/auth/register', () => {
  it('creates the user, persists it and starts a session', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const { user } = authResponseSchema.parse(res.body);
    expect(user).toMatchObject({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      timezone: 'America/Bogota',
    });
    expect(sessionCookie(res)).toBeDefined();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.email).toBe('ana@example.com');
  });

  it('stores an Argon2id hash, never the password, and never returns it', async () => {
    const res = await register();
    const row = await prisma.user.findFirstOrThrow();
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain(credentials.password);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('argon2');
    expect(body).not.toContain(credentials.password);
  });

  it('normalises the email to lowercase and trims the name', async () => {
    const res = await register({ ...credentials, name: '  Ana  ', email: '  ANA@Example.COM ' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
    expect((await prisma.user.findFirstOrThrow()).email).toBe('ana@example.com');
  });

  it.each([
    ['invalid email', { email: 'nope' }, 'email'],
    ['short password', { password: '1234567' }, 'password'],
    ['empty name', { name: '  ' }, 'name'],
  ])('rejects %s with VALIDATION_ERROR and field details', async (_l, patch, field) => {
    const res = await register({ ...credentials, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[field]).toBeDefined();
    expect(await prisma.user.count()).toBe(0);
  });

  it('does not echo the submitted password in validation errors', async () => {
    const res = await register({ ...credentials, email: 'bad', password: 'short' });
    expect(JSON.stringify(res.body)).not.toContain('short"');
  });

  it('rejects a missing body with VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/register');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate email (case-insensitively) with EMAIL_ALREADY_EXISTS', async () => {
    await register();
    const res = await register({ ...credentials, email: 'ANA@EXAMPLE.COM', name: 'Other' });
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('logs in with correct credentials and sets a session cookie', async () => {
    const res = await login({ email: credentials.email, password: credentials.password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(credentials.email);
    expect(sessionCookie(res)).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('accepts the email in any letter case', async () => {
    const res = await login({ email: 'ANA@Example.com', password: credentials.password });
    expect(res.status).toBe(200);
  });

  it('gives the same generic answer for a wrong password and an unknown user', async () => {
    const wrong = await login({ email: credentials.email, password: 'wrong-password' });
    const unknown = await login({ email: 'ghost@example.com', password: 'wrong-password' });

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Correo o contraseña incorrectos.');
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(wrong.body).toEqual(unknown.body);
  });

  it('validates the payload', async () => {
    const res = await login({ email: 'bad', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('issues a new token on every login (no session fixation)', async () => {
    const a = tokenFrom(sessionCookie(await login(credentials))!);
    const b = tokenFrom(sessionCookie(await login(credentials))!);
    expect(a).not.toBe(b);
  });
});

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax, Path=/, 7 days, with a specific name and no Secure in dev', async () => {
    const cookie = sessionCookie(await register())!;
    expect(cookie).toMatch(/^academic_planner_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(new RegExp(`Max-Age=${SESSION_TTL_MS / 1000}`));
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('is Secure when secureCookies is enabled (production)', async () => {
    const secureApp = buildApp({ secureCookies: true });
    const res = await request(secureApp).post('/api/auth/register').send(credentials);
    expect(sessionCookie(res)).toMatch(/Secure/i);
  });
});

describe('GET /api/auth/me and sessions', () => {
  it('returns the user for an authenticated session and keeps working (persistence)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(credentials).expect(201);

    for (let i = 0; i < 3; i++) {
      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(credentials.email);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('returns 401 UNAUTHENTICATED without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 for an invalid token and clears the cookie', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'academic_planner_session=totally-invalid');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('rejects an expired session and deletes it', async () => {
    const res = await register();
    const cookie = sessionCookie(res)!.split(';')[0]!;
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('stores only the SHA-256 of the token, never the token itself', async () => {
    const token = tokenFrom(sessionCookie(await register())!);
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
  });

  it('sets the session to expire in 7 days', async () => {
    await register();
    const row = await prisma.session.findFirstOrThrow();
    const delta = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(Math.abs(delta - SESSION_TTL_MS)).toBeLessThan(5_000);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session server-side: the old cookie stops working', async () => {
    const cookie = sessionCookie(await register())!.split(';')[0]!;
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(sessionCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.session.count()).toBe(0);

    // Replaying the stolen/old cookie must fail: revocation is not just cookie deletion.
    const replay = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('only revokes the current session, not the other devices of the user', async () => {
    const a = sessionCookie(await register())!.split(';')[0]!;
    const b = sessionCookie(await login(credentials))!.split(';')[0]!;
    await request(app).post('/api/auth/logout').set('Cookie', a);
    expect((await request(app).get('/api/auth/me').set('Cookie', b)).status).toBe(200);
  });

  it('is idempotent without a session', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });

  it('deletes sessions when the user is deleted (cascade)', async () => {
    await register();
    await prisma.user.deleteMany();
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('origin verification (CSRF defence in depth)', () => {
  const attempt = (headers: Record<string, string>) =>
    request(app)
      .post('/api/auth/login')
      .set(headers)
      .send({ email: 'x@example.com', password: 'whatever' });

  it('rejects a foreign Origin on a mutating request', async () => {
    const res = await attempt({ Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_ORIGIN');
  });

  it('rejects logout from a foreign Origin without revoking anything', async () => {
    const cookie = sessionCookie(await register())!.split(';')[0]!;
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(await prisma.session.count()).toBe(1);
  });

  it('rejects cross-site fetches that omit Origin (Sec-Fetch-Site)', async () => {
    expect((await attempt({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await attempt({ 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
  });

  it('allows the configured Origin, same-origin fetches and non-browser clients', async () => {
    expect((await attempt({ Origin: ORIGIN })).status).toBe(401); // passes origin check, bad creds
    expect((await attempt({ 'Sec-Fetch-Site': 'same-origin' })).status).toBe(401);
    expect((await attempt({})).status).toBe(401);
  });

  it('does not restrict safe methods', async () => {
    const res = await request(app).get('/api/auth/me').set('Origin', 'https://evil.example');
    expect(res.status).toBe(401); // UNAUTHENTICATED, not INVALID_ORIGIN
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('rate limiting', () => {
  it('limits failed logins per IP and answers RATE_LIMITED (429)', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 3, registerMax: 1000 } });
    const attempt = () =>
      request(limited).post('/api/auth/login').send({ email: 'x@example.com', password: 'nope' });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not count successful logins', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 2, registerMax: 1000 } });
    await request(limited).post('/api/auth/register').send(credentials).expect(201);
    for (let i = 0; i < 5; i++) {
      const res = await request(limited).post('/api/auth/login').send(credentials);
      expect(res.status).toBe(200);
    }
  });

  it('limits registrations per IP', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 1000, registerMax: 2 } });
    for (let i = 0; i < 2; i++) {
      await request(limited)
        .post('/api/auth/register')
        .send({ ...credentials, email: `u${i}@example.com` })
        .expect(201);
    }
    const res = await request(limited)
      .post('/api/auth/register')
      .send({ ...credentials, email: 'u3@example.com' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
