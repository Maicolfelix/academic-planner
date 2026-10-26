import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkCsp,
  checkSessionCookie,
  hasHsts,
  isHttps,
  noStore,
  originOf,
  parseSetCookie,
  smokeAccount,
  summarize,
} from './smoke-lib.mjs';

const PROD =
  '__Host-academic_planner_session=abc; Max-Age=604800; Path=/; Expires=Wed, 01 Jan 2030 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax';
const DEV = 'academic_planner_session=abc; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax';
const status = (results, id) => results.find((r) => r.id === id)?.status;

test('parseSetCookie reads the name, the value and the attributes', () => {
  const c = parseSetCookie(PROD);
  assert.equal(c.name, '__Host-academic_planner_session');
  assert.equal(c.value, 'abc');
  assert.equal(c.attrs.httponly, true);
  assert.equal(c.attrs.secure, true);
  assert.equal(c.attrs.samesite, 'Lax');
  assert.equal(c.attrs.path, '/');
  assert.ok(!('domain' in c.attrs));
});

test('over HTTPS the production cookie passes every check', () => {
  const results = checkSessionCookie(PROD, { https: true });
  assert.deepEqual(
    results.filter((r) => r.status !== 'pass'),
    [],
  );
});

test('over HTTPS a development-style cookie FAILS (wrong name, not Secure): a misconfigured NODE_ENV is caught', () => {
  const results = checkSessionCookie(DEV, { https: true });
  assert.equal(status(results, 'cookie-host-prefix'), 'fail');
  assert.equal(status(results, 'cookie-secure'), 'fail');
});

test('over plain HTTP the HTTPS-only checks are n/a, never green', () => {
  const results = checkSessionCookie(DEV, { https: false });
  assert.equal(status(results, 'cookie-host-prefix'), 'na');
  assert.equal(status(results, 'cookie-secure'), 'na');
  assert.equal(status(results, 'cookie-httponly'), 'pass');
  assert.equal(summarize(results).na, 2);
});

test('a Domain attribute, a wrong SameSite or a missing HttpOnly each fail', () => {
  assert.equal(
    status(checkSessionCookie(`${PROD}; Domain=example.edu`, { https: true }), 'cookie-no-domain'),
    'fail',
  );
  assert.equal(
    status(
      checkSessionCookie(PROD.replace('SameSite=Lax', 'SameSite=None'), { https: true }),
      'cookie-samesite',
    ),
    'fail',
  );
  assert.equal(
    status(checkSessionCookie(PROD.replace('HttpOnly; ', ''), { https: true }), 'cookie-httponly'),
    'fail',
  );
  assert.equal(status(checkSessionCookie(undefined, { https: true }), 'cookie-present'), 'fail');
});

test('only a failure makes the smoke fail', () => {
  assert.equal(summarize([{ status: 'pass' }, { status: 'na' }]).exitCode, 0);
  assert.equal(summarize([{ status: 'pass' }, { status: 'fail' }]).exitCode, 1);
});

test('the CSP check wants a policy that restricts scripts to the origin', () => {
  assert.equal(checkCsp("default-src 'self'; script-src 'self'; object-src 'none'").ok, true);
  assert.equal(checkCsp(undefined).ok, false);
  assert.equal(checkCsp("default-src 'self'; script-src 'self' 'unsafe-inline'").ok, false);
  assert.equal(checkCsp("script-src 'unsafe-eval'").ok, false);
});

test('HSTS, no-store, scheme and origin helpers', () => {
  assert.equal(hasHsts('max-age=15552000; includeSubDomains'), true);
  assert.equal(hasHsts(undefined), false);
  assert.equal(noStore('no-store'), true);
  assert.equal(noStore('public, max-age=60'), false);
  assert.equal(isHttps('https://planner.example.edu'), true);
  assert.equal(isHttps('http://localhost:3000'), false);
  assert.equal(
    originOf('https://planner.example.edu:8443/some/path'),
    'https://planner.example.edu:8443',
  );
});

test('each run gets a different synthetic account on a reserved .invalid domain', () => {
  const a = smokeAccount(1000, 0.1);
  const b = smokeAccount(2000, 0.1);
  assert.notEqual(a.email, b.email);
  assert.match(a.email, /^smoke-[a-z0-9]+@smoke\.planner\.invalid$/);
  assert.ok(a.password.length >= 12);
});
