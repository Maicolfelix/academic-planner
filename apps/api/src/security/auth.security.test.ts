import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SESSIONS_PER_USER } from '../auth/sessions.js';
import {
  buildApp,
  credentials,
  prisma,
  resetDb,
  sessionCookie,
  tokenFrom,
} from '../../test/helpers.js';

const app = buildApp();
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const register = (a = app, body: object = credentials) =>
  request(a).post('/api/auth/register').send(body);
const login = (a = app, body: object = credentials) =>
  request(a).post('/api/auth/login').send(body);
const withCookie = (cookie: string) => ({ Cookie: cookie });

describe('passwords', () => {
  it('are stored only as an Argon2id hash with the documented cost, and never leave the API', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|argon/i);
    const row = await prisma.user.findFirstOrThrow({ where: { email: credentials.email } });
    expect(row.passwordHash).not.toContain(credentials.password);
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
    for (const r of [
      await login(),
      await request(app)
        .get('/api/auth/me')
        .set(withCookie(sessionCookie(res)!)),
    ]) {
      expect(JSON.stringify(r.body)).not.toMatch(/password|hash|argon/i);
    }
  });

  it('the email is normalised, so case and spaces cannot create a second account', async () => {
    await register(app, { ...credentials, email: '  ANA@Example.COM ' });
    expect(await prisma.user.findMany({ select: { email: true } })).toEqual([
      { email: 'ana@example.com' },
    ]);
    expect((await register()).status).toBe(409);
  });

  it('the policy is length, not composition: 8 to 128 characters, any character, never trimmed', async () => {
    const ok = async (password: string, email: string) =>
      (await register(app, { ...credentials, email, password })).status;
    expect(await ok('1234567', 'a@example.com')).toBe(400); // 7
    expect(await ok('12345678', 'b@example.com')).toBe(201); // 8, no uppercase/symbol required
    expect(await ok('x'.repeat(128), 'c@example.com')).toBe(201);
    expect(await ok('x'.repeat(129), 'd@example.com')).toBe(400);
    expect(await ok('contraseña ñandú 🔐 segura', 'e@example.com')).toBe(201); // Unicode
    // Surrounding spaces are part of the password: it must be typed the same way to enter.
    await register(app, {
      ...credentials,
      email: 'f@example.com',
      password: '  espacios al borde  ',
    });
    expect(
      (await login(app, { email: 'f@example.com', password: 'espacios al borde' })).status,
    ).toBe(401);
    expect(
      (await login(app, { email: 'f@example.com', password: '  espacios al borde  ' })).status,
    ).toBe(200);
  });

  it('a huge password is refused cheaply, before any hashing', async () => {
    const t0 = Date.now();
    const a = await login(app, { email: credentials.email, password: 'x'.repeat(5000) });
    const b = await register(app, { ...credentials, password: 'x'.repeat(5000) });
    expect([a.status, b.status]).toEqual([400, 400]);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(
      (await login(app, { email: credentials.email, password: 'x'.repeat(300_000) })).status,
    ).toBe(413);
  });

  it('hashing costs what the documentation says (a few tenths of a second, not seconds)', async () => {
    await register(); // warm-up
    const t0 = Date.now();
    await register(app, { ...credentials, email: 'timing@example.com' });
    const ms = Date.now() - t0;
    console.info(`argon2id register: ${ms} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe('session tokens', () => {
  it('are 256 random bits, only their SHA-256 is stored, and the token itself is nowhere in the database', async () => {
    const res = await register();
    const token = tokenFrom(sessionCookie(res)!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(await prisma.session.findMany())).not.toContain(token);
    const a = tokenFrom(sessionCookie(await login())!);
    const b = tokenFrom(sessionCookie(await login())!);
    expect(new Set([token, a, b]).size).toBe(3);
  });

  it('are refused when junk: wrong length, wrong content, wrong cookie', async () => {
    for (const cookie of [
      'academic_planner_session=',
      `academic_planner_session=${'a'.repeat(500)}`,
      "academic_planner_session=' OR 1=1 --",
      'other=abc',
    ]) {
      const res = await request(app).get('/api/auth/me').set(withCookie(cookie));
      expect(res.status, cookie).toBe(401);
    }
  });
});

describe('cookie', () => {
  it('development: HttpOnly, SameSite=Lax, Path=/, a bounded Max-Age, no Domain, not Secure over plain HTTP', async () => {
    const cookie = sessionCookie(await register())!;
    expect(cookie).toMatch(/^academic_planner_session=/);
    for (const attr of [/HttpOnly/i, /SameSite=Lax/i, /Path=\//i, /Max-Age=604800/i])
      expect(cookie).toMatch(attr);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('production (HTTPS): Secure and the __Host- prefix (no Domain, Path=/), and the old name is not accepted', async () => {
    const secureApp = buildApp({ secureCookies: true });
    const res = await register(secureApp);
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/^__Host-academic_planner_session=/);
    for (const attr of [/HttpOnly/i, /SameSite=Lax/i, /Path=\//i, /Secure/i])
      expect(cookie).toMatch(attr);
    expect(cookie).not.toMatch(/Domain=/i);
    const token = tokenFrom(cookie);
    expect(
      (
        await request(secureApp)
          .get('/api/auth/me')
          .set(withCookie(`__Host-academic_planner_session=${token}`))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(secureApp)
          .get('/api/auth/me')
          .set(withCookie(`academic_planner_session=${token}`))
      ).status,
    ).toBe(401);
  });

  it('logout clears it with the same attributes', async () => {
    const res = await register();
    const out = await request(app)
      .post('/api/auth/logout')
      .set(withCookie(sessionCookie(res)!));
    expect(out.status).toBe(204);
    const cleared = sessionCookie(out)!;
    expect(cleared).toMatch(/academic_planner_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/HttpOnly/i);
  });
});

describe('session fixation, logout and expiry', () => {
  it('signing in issues a NEW token and revokes the one the browser was holding', async () => {
    const first = sessionCookie(await register())!;
    const old = tokenFrom(first);
    const second = await login(app).set(withCookie(first));
    const fresh = tokenFrom(sessionCookie(second)!);
    expect(fresh).not.toBe(old);
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set(withCookie(`academic_planner_session=${old}`))
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set(withCookie(`academic_planner_session=${fresh}`))
      ).status,
    ).toBe(200);
  });

  it('a token chosen by an attacker is never adopted as the session', async () => {
    await register();
    const planted = 'A'.repeat(43);
    const res = await login(app).set(withCookie(`academic_planner_session=${planted}`));
    expect(res.status).toBe(200);
    expect(tokenFrom(sessionCookie(res)!)).not.toBe(planted);
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set(withCookie(`academic_planner_session=${planted}`))
      ).status,
    ).toBe(401);
    expect(
      await prisma.session.count({
        where: { tokenHash: createHash('sha256').update(planted).digest('hex') },
      }),
    ).toBe(0);
  });

  it('logout destroys the session on the server: the copied token stops working', async () => {
    const res = await register();
    const cookie = sessionCookie(res)!;
    expect((await request(app).get('/api/auth/me').set(withCookie(cookie))).status).toBe(200);
    await request(app).post('/api/auth/logout').set(withCookie(cookie)).expect(204);
    expect((await request(app).get('/api/auth/me').set(withCookie(cookie))).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
    // Idempotent: logging out again (or without a session) is still a success.
    await request(app).post('/api/auth/logout').set(withCookie(cookie)).expect(204);
    await request(app).post('/api/auth/logout').expect(204);
  });

  it('an expired session does not authenticate, is deleted and can not be revived', async () => {
    const cookie = sessionCookie(await register())!;
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).get('/api/auth/me').set(withCookie(cookie));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(await prisma.session.count()).toBe(0);
    expect((await request(app).get('/api/auth/me').set(withCookie(cookie))).status).toBe(401);
  });

  it('expired sessions of everyone are cleaned up opportunistically on the next sign-in', async () => {
    await register();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await login();
    expect(await prisma.session.count()).toBe(1);
  });

  it('several devices are allowed, up to a bound; the oldest sessions are the ones dropped', async () => {
    const tokens: string[] = [tokenFrom(sessionCookie(await register())!)];
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 2; i++)
      tokens.push(tokenFrom(sessionCookie(await login())!));
    expect(await prisma.session.count()).toBe(MAX_SESSIONS_PER_USER);
    const status = async (t: string) =>
      (
        await request(app)
          .get('/api/auth/me')
          .set(withCookie(`academic_planner_session=${t}`))
      ).status;
    expect(await status(tokens[0]!)).toBe(401);
    expect(await status(tokens.at(-1)!)).toBe(200);
  });
});

describe('login does not reveal which part was wrong', () => {
  it('unknown email and wrong password are the same answer', async () => {
    await register();
    const wrongPassword = await login(app, { ...credentials, password: 'definitely wrong' });
    const unknownEmail = await login(app, {
      email: 'nadie@example.com',
      password: 'definitely wrong',
    });
    expect(wrongPassword.status).toBe(401);
    expect({ status: unknownEmail.status, body: unknownEmail.body }).toEqual({
      status: wrongPassword.status,
      body: wrongPassword.body,
    });
    expect(wrongPassword.body.error.message).toBe('Correo o contraseña incorrectos.');
  });

  it('an unknown email still pays for a password check (no cheap timing difference)', async () => {
    await register();
    const time = async (body: object) => {
      const t0 = performance.now();
      await login(app, body);
      return performance.now() - t0;
    };
    await time({ ...credentials, password: 'warm up wrong' });
    const known = Math.min(
      await time({ ...credentials, password: 'wrong one' }),
      await time({ ...credentials, password: 'wrong two' }),
    );
    const unknown = Math.min(
      await time({ email: 'nadie@example.com', password: 'wrong one' }),
      await time({ email: 'otro@example.com', password: 'wrong two' }),
    );
    // A functional check, not a cryptographic benchmark: both take an Argon2 verification's time.
    expect(unknown).toBeGreaterThan(known * 0.4);
  });

  it('registering an existing email says so (accepted trade-off, documented) but never leaks account data', async () => {
    await register();
    const res = await register();
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/Ana|hash|id/);
  });
});

describe('rate limits (small limits injected, no sleeping)', () => {
  it('login: only FAILURES count, the next one over the limit is a 429 with Retry-After and a generic message', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 3, registerMax: 100 } });
    await register(limited);
    const good = { ...credentials };
    const bad = { ...credentials, password: 'wrong wrong' };
    expect((await login(limited, bad)).status).toBe(401); // failure 1
    for (let i = 0; i < 6; i++) expect((await login(limited, good)).status).toBe(200); // successes do not count
    expect((await login(limited, bad)).status).toBe(401); // failure 2
    expect((await login(limited, bad)).status).toBe(401); // failure 3
    const blocked = await login(limited, bad);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.message).not.toMatch(/correo|cuenta|existe/i);
    // The same wall for an email that has no account: the answer never says whether it exists.
    const other = buildApp({ rateLimits: { loginMax: 1, registerMax: 100 } });
    await login(other, { email: 'fantasma@example.com', password: 'whatever1' });
    const blockedGhost = await login(other, {
      email: 'fantasma@example.com',
      password: 'whatever1',
    });
    expect(blockedGhost.status).toBe(429);
    expect(blockedGhost.body).toEqual(
      (await login(other, { email: credentials.email, password: 'whatever1' })).body,
    );
  });

  it('register: the (N+1)th sign-up from the same client is a 429', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 100, registerMax: 2 } });
    expect((await register(limited, { ...credentials, email: 'a@example.com' })).status).toBe(201);
    expect((await register(limited, { ...credentials, email: 'b@example.com' })).status).toBe(201);
    const res = await register(limited, { ...credentials, email: 'c@example.com' });
    expect(res.status).toBe(429);
    expect(await prisma.user.count()).toBe(2);
  });

  it('a spoofed X-Forwarded-For does NOT escape the limit when no proxy is trusted (the default)', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 2, registerMax: 100 } });
    const bad = { email: 'x@example.com', password: 'wrong wrong' };
    const statuses: number[] = [];
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      statuses.push((await login(limited, bad).set('X-Forwarded-For', ip)).status);
    }
    expect(statuses).toEqual([401, 401, 429, 429]);
  });

  it('behind ONE trusted proxy the client address comes from X-Forwarded-For (what TRUST_PROXY=1 is for)', async () => {
    const limited = buildApp({ rateLimits: { loginMax: 2, registerMax: 100 }, trustProxy: 1 });
    const bad = { email: 'x@example.com', password: 'wrong wrong' };
    const first = [];
    for (const ip of ['1.1.1.1', '1.1.1.1', '1.1.1.1'])
      first.push((await login(limited, bad).set('X-Forwarded-For', ip)).status);
    expect(first).toEqual([401, 401, 429]); // one client: limited
    expect((await login(limited, bad).set('X-Forwarded-For', '9.9.9.9')).status).toBe(401); // another client: its own budget
  });
});

describe('what reaches the logs', () => {
  it('no password, hash or session token is ever written to the console during auth flows', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const secret = 'una-contraseña-muy-secreta-123';
    const reg = await register(app, { ...credentials, password: secret });
    const token = tokenFrom(sessionCookie(reg)!);
    await login(app, { ...credentials, password: secret });
    await login(app, { ...credentials, password: 'otra-equivocada-456' });
    await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"' + secret + '"'); // malformed JSON
    await request(app)
      .post('/api/auth/logout')
      .set(withCookie(`academic_planner_session=${token}`));
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const forbidden of [secret, 'otra-equivocada-456', token, 'argon2id'])
      expect(logged).not.toContain(forbidden);
  });
});
