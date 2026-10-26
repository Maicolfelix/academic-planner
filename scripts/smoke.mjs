#!/usr/bin/env node
// Production smoke: drives a RUNNING deployment as an external client (like a browser would), through its public URL only.
//
//   BASE_URL=https://planner.example.edu node scripts/smoke.mjs            # minimal: health, app shell, one account, one write
//   BASE_URL=http://localhost:3000       node scripts/smoke.mjs --full     # also subject, activity, complete, re-login persistence
//
// It knows nothing of the test database, fixtures, rate-limit overrides or Prisma, and it needs no bypass: one account per run.
// The API has NO account deletion, so each run leaves one synthetic account (smoke-…@smoke.planner.invalid) and what it
// created (documented in docs/deployment.md). Checks that need a real HTTPS origin are reported "n/a", never green.

import {
  checkCsp,
  checkSessionCookie,
  hasHsts,
  isHttps,
  noStore,
  originOf,
  smokeAccount,
  summarize,
} from './smoke-lib.mjs';

const args = process.argv.slice(2);
const full = args.includes('--full');
const baseUrl = (process.env.BASE_URL ?? args.find((a) => !a.startsWith('--')) ?? '').replace(
  /\/+$/,
  '',
);
if (!baseUrl) {
  console.error('Usage: BASE_URL=https://host node scripts/smoke.mjs [--full]');
  process.exit(2);
}
const https = isHttps(baseUrl);
const origin = originOf(baseUrl);
const results = [];
const record = (id, label, status, detail) => {
  results.push({ id, label, status, ...(detail ? { detail } : {}) });
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'N/A ';
  console.log(`${mark}  ${label}${detail && status !== 'pass' ? `  — ${detail}` : ''}`);
};
const check = (id, label, ok, detail) =>
  record(id, label, ok ? 'pass' : 'fail', ok ? undefined : detail);

let cookie = '';
async function call(
  method,
  path,
  { body, withCookie = true, headers = {}, sendOrigin = method !== 'GET' } = {},
) {
  const res = await fetch(baseUrl + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      // A browser sends the page's Origin on writes: the same here, which also proves CORS_ORIGIN matches the public URL.
      ...(sendOrigin && { origin }),
      ...(withCookie && cookie && { cookie }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}
const sessionOf = (res) => {
  const header = res.headers.getSetCookie().find((c) => /academic_planner_session=/.test(c));
  return { header, pair: header?.split(';')[0] ?? '' };
};

async function run() {
  console.log(
    `Smoke against ${baseUrl}  (${https ? 'HTTPS' : 'HTTP: HTTPS-only checks will be n/a'}${full ? ', full' : ''})\n`,
  );

  // 1. health
  const health = await call('GET', '/api/health');
  check(
    'health',
    'GET /api/health is 200 with the database up',
    health.status === 200 && health.json?.database === 'up',
    `status ${health.status} ${health.text.slice(0, 80)}`,
  );
  check(
    'health-no-store',
    '/api answers are Cache-Control: no-store',
    noStore(health.headers.get('cache-control')),
    `Cache-Control was ${health.headers.get('cache-control')}`,
  );

  // 2-3. the app, one origin
  const home = await call('GET', '/');
  check(
    'app-html',
    'GET / is the app (HTML shell)',
    home.status === 200 &&
      /text\/html/.test(home.headers.get('content-type') ?? '') &&
      /<div id="root"/.test(home.text),
    `status ${home.status}`,
  );
  const csp = checkCsp(home.headers.get('content-security-policy'));
  check(
    'csp',
    "the app is served with a strict CSP ('self', no unsafe-inline/eval scripts)",
    csp.ok,
    csp.detail,
  );
  const deep = await call('GET', '/dashboard');
  check(
    'deep-link',
    'GET /dashboard (no session) gets the app shell, not a 404 or JSON',
    deep.status === 200 && /<div id="root"/.test(deep.text),
    `status ${deep.status}`,
  );
  const missingApi = await call('GET', '/api/this-route-does-not-exist');
  check(
    'api-not-shell',
    'an unknown /api route is a JSON 404, never the app shell',
    missingApi.status === 404 &&
      missingApi.json !== undefined &&
      !/<div id="root"/.test(missingApi.text),
    `status ${missingApi.status}`,
  );
  const sw = await call('GET', '/manifest.webmanifest');
  check(
    'manifest',
    'the PWA manifest is served',
    sw.status === 200 && sw.json?.share_target?.action === '/share',
    `status ${sw.status}`,
  );

  // HSTS: only meaningful (and only sent) over HTTPS
  if (https)
    check(
      'hsts',
      'Strict-Transport-Security is present',
      hasHsts(home.headers.get('strict-transport-security')),
      'no HSTS header',
    );
  else record('hsts', 'Strict-Transport-Security is present', 'na', 'BASE_URL is not HTTPS');

  // 4. a write from another origin is refused (CSRF), and creates nothing
  const forged = await call('POST', '/api/auth/login', {
    body: { email: 'nobody@smoke.planner.invalid', password: 'x' },
    headers: { origin: 'https://forged.invalid' },
  });
  check(
    'origin-check',
    'a write with a foreign Origin is refused (403 INVALID_ORIGIN)',
    forged.status === 403 && forged.json?.error?.code === 'INVALID_ORIGIN',
    `status ${forged.status}`,
  );

  // 5. register: one account per run
  const account = smokeAccount();
  const registered = await call('POST', '/api/auth/register', { body: account, withCookie: false });
  check(
    'register',
    'registering a new account works (201)',
    registered.status === 201,
    `status ${registered.status} ${registered.json?.error?.code ?? ''} (is CORS_ORIGIN the exact public origin?)`,
  );
  if (registered.status !== 201) return;
  const session = sessionOf(registered);
  cookie = session.pair;
  for (const r of checkSessionCookie(session.header, { https }))
    record(r.id, r.label, r.status, r.detail);

  // 6. who am I
  const me = await call('GET', '/api/auth/me');
  check(
    'me',
    'GET /api/auth/me returns the account',
    me.status === 200 && me.json?.user?.email === account.email,
    `status ${me.status}`,
  );

  // 7. a small authenticated write (a period) and read it back
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const period = await call('POST', '/api/periods', {
    body: {
      name: 'Smoke',
      startDate: iso(new Date(today.getTime() - 30 * 864e5)),
      endDate: iso(new Date(today.getTime() + 90 * 864e5)),
      isCurrent: true,
    },
  });
  check(
    'write',
    'an authenticated write works (create a period)',
    period.status === 201,
    `status ${period.status} ${period.json?.error?.code ?? ''}`,
  );
  const periods = await call('GET', '/api/periods');
  check(
    'read-back',
    'and it reads back',
    periods.status === 200 && periods.json?.periods?.some((p) => p.id === period.json?.period?.id),
    `status ${periods.status}`,
  );

  let activityTitle;
  if (full) {
    const subject = await call('POST', '/api/subjects', {
      body: { periodId: period.json.period.id, name: 'Redes (smoke)' },
    });
    check('subject', '(full) create a subject', subject.status === 201, `status ${subject.status}`);
    activityTitle = `Entrega de humo ${Date.now()}`;
    const due = iso(new Date(today.getTime() + 5 * 864e5));
    const activity = await call('POST', '/api/activities', {
      body: {
        subjectId: subject.json?.subject?.id,
        title: activityTitle,
        type: 'TASK',
        dueDate: due,
      },
    });
    check(
      'activity',
      '(full) create an activity',
      activity.status === 201,
      `status ${activity.status}`,
    );
    const done = await call('PATCH', `/api/activities/${activity.json?.activity?.id}`, {
      body: { status: 'COMPLETED' },
    });
    check(
      'complete',
      '(full) complete the activity',
      done.status === 200 && done.json?.activity?.status === 'COMPLETED',
      `status ${done.status}`,
    );
    const dash = await call('GET', '/api/dashboard');
    check(
      'dashboard',
      '(full) the dashboard answers with the data',
      dash.status === 200,
      `status ${dash.status}`,
    );
  }

  // 8. logout kills the session (the OLD token is dead, not just forgotten by us)
  const oldCookie = cookie;
  const out = await call('POST', '/api/auth/logout');
  check('logout', 'logout works (204)', out.status === 204, `status ${out.status}`);
  const meOld = await call('GET', '/api/auth/me', {
    headers: { cookie: oldCookie },
    withCookie: false,
  });
  check(
    'session-dead',
    'the old session token no longer authenticates (401)',
    meOld.status === 401,
    `status ${meOld.status}`,
  );
  const meNone = await call('GET', '/api/auth/me', { withCookie: false });
  check(
    'anonymous',
    'without a cookie /api/auth/me is 401',
    meNone.status === 401,
    `status ${meNone.status}`,
  );

  // 9. a real login with the same account
  cookie = '';
  const login = await call('POST', '/api/auth/login', {
    body: { email: account.email, password: account.password },
    withCookie: false,
  });
  check('login', 'logging in again works (200)', login.status === 200, `status ${login.status}`);
  cookie = sessionOf(login).pair;
  const meAgain = await call('GET', '/api/auth/me');
  check(
    'login-session',
    'and the new session authenticates',
    meAgain.status === 200,
    `status ${meAgain.status}`,
  );
  if (full) {
    const list = await call('GET', '/api/activities');
    const found = list.json?.activities?.find((a) => a.title === activityTitle);
    check(
      'persisted',
      '(full) the completed activity persisted across sessions',
      found?.status === 'COMPLETED',
      `status ${list.status}, found ${found ? found.status : 'nothing'}`,
    );
  }
  await call('POST', '/api/auth/logout');
}

try {
  await run();
} catch (err) {
  record('crash', 'the smoke ran to the end', 'fail', String(err?.message ?? err));
}
const { pass, fail, na, exitCode } = summarize(results);
console.log(
  `\n${pass} passed, ${fail} failed, ${na} not applicable${https ? '' : ' (BASE_URL is not HTTPS)'}`,
);
process.exit(exitCode);
