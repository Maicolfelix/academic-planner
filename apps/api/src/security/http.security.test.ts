import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORIGIN,
  buildApp,
  credentials,
  postActivity,
  prisma,
  resetDb,
  sessionCookie,
  setupUser,
} from '../../test/helpers.js';

const app = buildApp();
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const EVIL = 'https://evil.example';
const uuid = () => randomUUID();

// ───────────────────────── CSRF: every state-changing route ─────────────────────────

/** Every route that is not a GET. A new one must be added here (the inventory test below counts them). */
const MUTATING: [method: 'post' | 'patch' | 'delete', path: string, body?: object][] = [
  [
    'post',
    '/api/auth/register',
    { name: 'X', email: 'csrf@example.com', password: 'correct horse battery' },
  ],
  ['post', '/api/auth/login', { email: credentials.email, password: credentials.password }],
  ['post', '/api/auth/logout'],
  ['post', '/api/periods', { name: 'P', startDate: '2026-08-03', endDate: '2026-11-28' }],
  ['patch', `/api/periods/${uuid()}`, { name: 'P' }],
  ['delete', `/api/periods/${uuid()}`],
  ['post', '/api/subjects', { name: 'S' }],
  ['patch', `/api/subjects/${uuid()}`, { name: 'S' }],
  ['delete', `/api/subjects/${uuid()}`],
  ['post', '/api/activities', { title: 'A' }],
  ['patch', `/api/activities/${uuid()}`, { title: 'A' }],
  ['delete', `/api/activities/${uuid()}`],
  ['post', '/api/schedule', { title: 'B' }],
  ['patch', `/api/schedule/${uuid()}`, { title: 'B' }],
  ['delete', `/api/schedule/${uuid()}`],
  ['post', '/api/reminders', { activityId: uuid() }],
  ['post', '/api/reminders/seen', { ids: [uuid()] }],
  ['patch', `/api/reminders/${uuid()}`, { remindDate: '2026-10-08' }],
  ['delete', `/api/reminders/${uuid()}`],
  ['post', '/api/quick-capture/parse', { text: 'parcial' }],
  ['post', '/api/academic-inbox/parse', { text: 'parcial' }],
  ['post', '/api/schedule-import/parse'],
];

describe('CSRF: a request that does not come from our own origin never changes anything', () => {
  const call = (method: string, p: string, body?: object) =>
    (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(p).send(
      body ?? {},
    );

  it.each(MUTATING)('%s %s', async (method, p, body) => {
    const bad = [
      { Origin: EVIL },
      { Origin: 'null' },
      { Origin: `${ORIGIN}.evil.example` },
      { Origin: ORIGIN.replace('http:', 'https:') },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const headers of bad) {
      const res = await call(method, p, body).set(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.body.error.code).toBe('INVALID_ORIGIN');
    }
    // Our own origin passes the check (the route may still answer 400/401/404 for other reasons, never 403 INVALID_ORIGIN).
    for (const headers of [
      { Origin: ORIGIN },
      { 'Sec-Fetch-Site': 'same-origin' },
      { 'Sec-Fetch-Site': 'none' },
      {},
    ]) {
      const res = await call(method, p, body).set(headers);
      expect(res.body?.error?.code, JSON.stringify(headers)).not.toBe('INVALID_ORIGIN');
    }
  });

  it('the list above is the complete list of non-GET routes of the API', async () => {
    const src = (dir: string): string[] =>
      fs
        .readdirSync(dir)
        .flatMap((f) =>
          f.endsWith('.ts') && !f.includes('test')
            ? [fs.readFileSync(path.join(dir, f), 'utf8')]
            : [],
        );
    const routesDir = path.resolve(__dirname, '../routes');
    const declared =
      src(routesDir)
        .join('\n')
        .match(/router\.(post|patch|put|delete)\(/g) ?? [];
    expect(declared.length).toBe(MUTATING.length);
    expect(src(routesDir).join('\n')).not.toMatch(/router\.put\(/);
  });

  it('a forged request does not end the victim’s session, create data or touch the database', async () => {
    const { agent, subject } = await setupUser(app, 'victim@example.com');
    const before = [
      await prisma.session.count(),
      await prisma.activity.count(),
      await prisma.subject.count(),
    ];
    await agent.post('/api/auth/logout').set('Origin', EVIL).expect(403);
    await agent
      .post('/api/activities')
      .set('Origin', EVIL)
      .send({ subjectId: subject.id, title: 'Plantada', dueDate: '2026-12-01' })
      .expect(403);
    await agent.delete(`/api/subjects/${subject.id}`).set('Origin', EVIL).expect(403);
    expect([
      await prisma.session.count(),
      await prisma.activity.count(),
      await prisma.subject.count(),
    ]).toEqual(before);
    await agent.get('/api/auth/me').expect(200);
  });

  it('a GET is never a state change: reading the due reminders does not mark them as shown', async () => {
    const { agent, subject } = await setupUser(app, 'reader@example.com');
    await postActivity(agent, subject.id, {
      title: 'Parcial',
      type: 'EXAM',
      dueDate: bogota(1),
      dueTime: '10:00',
    });
    const snapshot = async () =>
      JSON.stringify(await prisma.reminder.findMany({ orderBy: { id: 'asc' } }));
    const before = await snapshot();
    for (const p of [
      '/api/reminders/due',
      '/api/reminders',
      '/api/dashboard',
      '/api/radar',
      '/api/attention',
      '/api/progress',
      '/api/workload',
      '/api/schedule',
    ]) {
      await agent.get(p);
    }
    expect(await snapshot()).toBe(before);
  });
});

function bogota(plusDays: number) {
  return new Date(Date.now() + plusDays * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  });
}

// ───────────────────────── CORS ─────────────────────────

describe('CORS', () => {
  it('answers the allowed origin exactly, with credentials, and never with a wildcard', async () => {
    const res = await request(app)
      .options('/api/activities')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('gives a foreign origin no permission at all', async () => {
    for (const origin of [EVIL, 'null', 'http://localhost:5174']) {
      const pre = await request(app)
        .options('/api/activities')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
      expect(pre.headers['access-control-allow-origin'], origin).toBeUndefined();
      const res = await request(app).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('refuses a configuration that would allow every origin with credentials', async () => {
    const { loadEnv } = await import('../config/env.js');
    const base = { DATABASE_URL: 'postgresql://x' };
    for (const bad of [
      '*',
      'localhost:5173',
      'http://localhost:5173/',
      'javascript:alert(1)',
      'http://a.example,*',
    ]) {
      expect(() => loadEnv({ ...base, CORS_ORIGIN: bad }), bad).toThrow(/CORS_ORIGIN/);
    }
    expect(
      loadEnv({ ...base, CORS_ORIGIN: 'https://app.example.com,http://localhost:5173' })
        .CORS_ORIGIN,
    ).toHaveLength(2);
  });

  it('refuses TRUST_PROXY=true (it would make every rate limit bypassable) and accepts a hop count', async () => {
    const { loadEnv } = await import('../config/env.js');
    const base = { DATABASE_URL: 'postgresql://x' };
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(loadEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
    expect(loadEnv(base).TRUST_PROXY).toBeUndefined();
  });
});

// ───────────────────────── Headers, caching, errors ─────────────────────────

describe('security headers', () => {
  it('every response carries the baseline (CSP, no sniffing, no framing, referrer, permissions)', async () => {
    for (const res of [
      await request(app).get('/api/health'),
      await request(app).get('/api/nope'),
      await request(app).get('/api/auth/me'),
    ]) {
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      const scriptSrc = csp.split(';').find((d) => d.startsWith('script-src'))!;
      expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval|\*|data:|blob:/);
      expect(csp).not.toMatch(/default-src[^;]*unsafe/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['permissions-policy']).toMatch(
        /camera=\(\).*microphone=\(\).*geolocation=\(\)/,
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    }
  });

  it('HSTS only when the deployment is HTTPS (localhost over HTTP must not be pinned)', async () => {
    expect(
      (await request(app).get('/api/health')).headers['strict-transport-security'],
    ).toBeUndefined();
    const https = buildApp({ secureCookies: true });
    expect((await request(https).get('/api/health')).headers['strict-transport-security']).toMatch(
      /max-age=15552000; includeSubDomains/,
    );
  });
});

describe('private responses are never stored by a browser or proxy', () => {
  it('every API answer, success or error, is no-store', async () => {
    const { agent } = await setupUser(app, 'cache@example.com');
    const paths = [
      '/api/auth/me',
      '/api/periods',
      '/api/subjects',
      '/api/activities',
      '/api/schedule',
      '/api/reminders',
      '/api/reminders/due',
      '/api/dashboard',
      '/api/radar',
      '/api/attention',
      '/api/progress',
      '/api/workload',
      '/api/health',
    ];
    for (const p of paths)
      expect((await agent.get(p)).headers['cache-control'], p).toBe('no-store');
    for (const res of [
      await request(app).get('/api/auth/me'),
      await request(app).get('/api/nope'),
      await agent.post('/api/activities').send({}),
      await agent.post('/api/quick-capture/parse').send({ text: 'parcial redes' }),
      await agent.post('/api/academic-inbox/parse').send({ text: 'parcial' }),
    ]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('errors reveal nothing', () => {
  it('an unexpected failure answers a generic 500: no message, stack, SQL or path', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = buildApp({
      checkDatabase: () => {
        throw new Error(
          'connect ECONNREFUSED postgresql://planner:SECRETPW@example.test:5432/db at C:\\Users\\dev\\academic-planner\\src\\db.ts:42',
        );
      },
    });
    const res = await request(broken).get('/api/health');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toMatch(
      /SECRETPW|ECONNREFUSED|postgres|C:\\|stack|\.ts/,
    );
    expect(quiet).toHaveBeenCalled(); // the detail goes to the server log only
  });

  it('a unique-constraint violation is a domain error (409), never SQL or Prisma text', async () => {
    const { agent, period } = await setupUser(app, 'dup@example.com', 'Redes');
    const res = await agent.post('/api/subjects').send({ periodId: period.id, name: 'redes' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(
      /prisma|unique constraint|P2002|SELECT|INSERT|"public"/i,
    );
  });

  it('unknown routes, unsupported methods and bad ids give the same plain 404 / validation answer', async () => {
    const { agent } = await setupUser(app, 'm@example.com');
    for (const res of [
      await agent.get('/api/nope'),
      await agent.put('/api/activities'),
      await agent.delete('/api/activities'),
      await agent.patch('/api/dashboard').send({}),
      await agent.get('/api/activities/not-a-uuid'),
    ]) {
      expect([404, 405]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/Cannot|Express|route|stack|\/api\//i);
    }
  });

  it('the health endpoint says only what it needs to', async () => {
    const res = await request(app).get('/api/health');
    expect(Object.keys(res.body).sort()).toEqual(['database', 'status', 'timestamp']);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|localhost|planner|password|version/i);
  });
});

// ───────────────────────── Request size and type ─────────────────────────

describe('request limits', () => {
  it('a JSON body over the limit is a 413 and the server keeps working', async () => {
    const { agent } = await setupUser(app, 'big@example.com');
    const big = await agent
      .post('/api/activities')
      .set('Content-Type', 'application/json')
      .send(`{"title":"${'x'.repeat(200_000)}"}`);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('a body of an unexpected type is a 415 before any parser looks at it', async () => {
    const { agent } = await setupUser(app, 'ct@example.com');
    const sends = [
      () => agent.post('/api/activities').set('Content-Type', 'text/plain').send('hola'),
      () => agent.post('/api/activities').type('form').send({ title: 'x' }),
      () => agent.post('/api/activities').attach('file', Buffer.from('x'), 'a.txt'),
    ];
    for (const send of sends) expect((await send()).status).toBe(415);
  });

  it('only the import route takes a file, and only ONE file in the field "file"', async () => {
    const { agent } = await setupUser(app, 'up@example.com');
    expect((await agent.post('/api/schedule-import/parse').send({ file: 'x' })).status).toBe(400);
    const many = await agent
      .post('/api/schedule-import/parse')
      .attach('file', Buffer.from('a'), 'a.png')
      .attach('file', Buffer.from('b'), 'b.png');
    expect(many.status).toBe(400);
    const other = await agent
      .post('/api/schedule-import/parse')
      .attach('archivo', Buffer.from('a'), 'a.png');
    expect(other.status).toBe(400);
  });

  it('malformed JSON is a 400 in our words, not a stack', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at |JSON\.parse/);
  });
});

// ───────────────────────── The web app served from the API (production topology) ─────────────────────────

describe('static web app (WEB_DIST_DIR)', () => {
  let dir: string;
  let web: ReturnType<typeof buildApp>;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-web-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><title>Shell</title><div id="root"></div>',
    );
    fs.writeFileSync(path.join(dir, 'assets', 'app.abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'sw.js'), '// sw');
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgresql://secret');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'config'), 'secret');
    web = buildApp({ webDistDir: dir });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('serves the shell for client routes (deep links) and the files with the right caching', async () => {
    for (const p of ['/', '/dashboard', '/calendar/import', '/algo/que/no/existe']) {
      const res = await request(web).get(p);
      expect(res.status, p).toBe(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    }
    const asset = await request(web).get('/assets/app.abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(web).get('/sw.js')).headers['cache-control']).toBe('no-cache');
  });

  it('an unknown /api path stays an API 404 (never the shell with 200); a missing file is a real 404', async () => {
    for (const p of ['/api/unknown', '/api/auth/nope', '/api']) {
      const res = await request(web).get(p);
      expect(res.status, p).toBe(404);
      expect(res.headers['content-type']).toMatch(/json/);
    }
    const missing = await request(web).get('/assets/missing.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<div id="root">');
  });

  it('never serves dotfiles, files outside the folder, or a directory listing', async () => {
    for (const p of [
      '/.env',
      '/.git/config',
      '/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/package.json',
      '/assets/..%2f..%2fpackage.json',
      '/assets/%2e%2e/.env',
      '/..\\..\\package.json',
    ]) {
      const res = await request(web).get(p);
      expect(res.text, p).not.toMatch(/DATABASE_URL|"workspaces"|secret/);
      expect([200, 400, 403, 404], p).toContain(res.status);
      if (res.status === 200) expect(res.text).toContain('<div id="root">'); // only ever the shell
    }
    const listing = await request(web).get('/assets/');
    expect(listing.text).not.toMatch(/app\.abc123\.js|Index of/);
  });

  it('is read-only: no method but GET/HEAD reaches the files', async () => {
    for (const method of ['post', 'put', 'delete', 'patch'] as const) {
      const res = await (request(web) as unknown as Record<string, (u: string) => request.Test>)[
        method
      ]!('/assets/app.abc123.js').send({});
      expect([403, 404, 415]).toContain(res.status);
    }
  });
});

describe('the real production build', () => {
  const dist = path.resolve(__dirname, '../../../web/dist');

  it('ships no source maps and nothing but the bundle', () => {
    if (!fs.existsSync(dist)) return; // `npm run build` not run yet
    const files = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' });
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
    expect(files.filter((f) => /(^|[\\/])\.|\.env|\.ts$|\.tsx$/.test(f))).toEqual([]);
    const js = files.filter((f) => f.endsWith('.js'));
    for (const f of js)
      expect(fs.readFileSync(path.join(dist, f), 'utf8')).not.toMatch(
        /sourceMappingURL|DATABASE_URL|SECRETPW/,
      );
  });

  it('index.html needs no inline script (so script-src has no unsafe-inline)', () => {
    if (!fs.existsSync(dist)) return;
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe('session cookie of a different user does not mix', () => {
  it('two browsers, two sessions, no crossover', async () => {
    const a = await setupUser(app, 'a@example.com');
    const b = await setupUser(app, 'b@example.com');
    expect((await a.agent.get('/api/auth/me')).body.user.email).toBe('a@example.com');
    expect((await b.agent.get('/api/auth/me')).body.user.email).toBe('b@example.com');
    expect(sessionCookie({ headers: { 'set-cookie': [] } })).toBeUndefined();
  });
});
