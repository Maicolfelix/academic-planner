// Pure helpers of the production smoke (scripts/smoke.mjs). No network, no globals: unit-tested in smoke-lib.test.mjs.

export const SESSION_COOKIE = 'academic_planner_session';

/** "name=value; Attr; Attr=value" -> { name, value, attrs } with lower-cased attribute names. */
export function parseSetCookie(header) {
  const [pair, ...rest] = String(header)
    .split(';')
    .map((p) => p.trim());
  const eq = pair.indexOf('=');
  const attrs = {};
  for (const part of rest) {
    const i = part.indexOf('=');
    const key = (i === -1 ? part : part.slice(0, i)).toLowerCase();
    attrs[key] = i === -1 ? true : part.slice(i + 1);
  }
  return {
    name: eq === -1 ? pair : pair.slice(0, eq),
    value: eq === -1 ? '' : pair.slice(eq + 1),
    attrs,
  };
}

export const isHttps = (baseUrl) => new URL(baseUrl).protocol === 'https:';

/** The Origin a browser would send from this page: scheme + host + port, no path. */
export const originOf = (baseUrl) => new URL(baseUrl).origin;

/** A fresh, obviously-synthetic account per run (the API has no account deletion: see docs/deployment.md). */
export function smokeAccount(now = Date.now(), random = Math.random()) {
  const tag = `${now.toString(36)}${Math.floor(random * 1e6).toString(36)}`;
  return {
    name: 'Smoke Test',
    email: `smoke-${tag}@smoke.planner.invalid`,
    password: `smoke-${tag}-correct-horse`,
  };
}

/**
 * Checks of the session cookie. Always: HttpOnly, SameSite=Lax, Path=/ and no Domain. Only over HTTPS (`https`): the
 * `__Host-` prefix and Secure, which a plain-HTTP/development server correctly does not use; there they are `na`.
 * @returns {{ id: string, label: string, status: 'pass'|'fail'|'na', detail?: string }[]}
 */
export function checkSessionCookie(setCookie, { https }) {
  const results = [];
  const add = (id, label, ok, detail) =>
    results.push({ id, label, status: ok ? 'pass' : 'fail', ...(ok ? {} : { detail }) });
  if (!setCookie) {
    add('cookie-present', 'the session cookie is set', false, 'no Set-Cookie for the session');
    return results;
  }
  const c = parseSetCookie(setCookie);
  add(
    'cookie-present',
    'the session cookie is set',
    c.name.endsWith(SESSION_COOKIE),
    `name was ${c.name}`,
  );
  add('cookie-httponly', 'cookie is HttpOnly', c.attrs.httponly === true, 'missing HttpOnly');
  add(
    'cookie-samesite',
    'cookie is SameSite=Lax',
    String(c.attrs.samesite).toLowerCase() === 'lax',
    `SameSite was ${c.attrs.samesite}`,
  );
  add('cookie-path', 'cookie has Path=/', c.attrs.path === '/', `Path was ${c.attrs.path}`);
  add(
    'cookie-no-domain',
    'cookie has no Domain (host-only)',
    !('domain' in c.attrs),
    'a Domain attribute is present',
  );
  if (https) {
    add(
      'cookie-host-prefix',
      'cookie uses the __Host- prefix',
      c.name === `__Host-${SESSION_COOKIE}`,
      `name was ${c.name}`,
    );
    add('cookie-secure', 'cookie is Secure', c.attrs.secure === true, 'missing Secure');
  } else {
    for (const [id, label] of [
      ['cookie-host-prefix', 'cookie uses the __Host- prefix'],
      ['cookie-secure', 'cookie is Secure'],
    ])
      results.push({
        id,
        label,
        status: 'na',
        detail: 'BASE_URL is not HTTPS: only a real HTTPS origin can show this',
      });
  }
  return results;
}

/** CSP must exist, restrict to 'self' and not allow inline/eval scripts. */
export function checkCsp(csp) {
  if (!csp) return { ok: false, detail: 'no Content-Security-Policy header' };
  const script = /(?:^|;)\s*script-src\s+([^;]*)/i.exec(csp)?.[1] ?? '';
  if (!/'self'/.test(csp)) return { ok: false, detail: "CSP does not mention 'self'" };
  if (/'unsafe-inline'|'unsafe-eval'/.test(script))
    return { ok: false, detail: 'script-src allows unsafe-inline/eval' };
  return { ok: true };
}

export const hasHsts = (value) => /max-age=\d+/i.test(String(value ?? ''));

export const noStore = (value) => /no-store/i.test(String(value ?? ''));

/** pass/fail/na counts and the exit code: only a `fail` makes the smoke fail (`na` is never counted as green). */
export function summarize(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    pass: count('pass'),
    fail: count('fail'),
    na: count('na'),
    exitCode: count('fail') > 0 ? 1 : 0,
  };
}
