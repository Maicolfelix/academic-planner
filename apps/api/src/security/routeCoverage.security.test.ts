import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, ORIGIN, prisma, resetDb, signUp } from '../../test/helpers.js';

/**
 * The security matrices are written by hand, so a route added later can be forgotten. This one is DERIVED from the routers'
 * source (the same way the CSRF test counts them): every route that exists must refuse an anonymous caller, and every route that
 * takes an id must appear in the ownership matrix.
 */
const srcDir = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(srcDir, file), 'utf8');

function inventory(): { method: string; path: string }[] {
  const mounts: Record<string, string> = {};
  for (const m of read('app.ts').matchAll(/app\.use\(\s*'(\/api[^']*)',\s*(\w+Router)\(/g))
    mounts[m[2]!] = m[1]!;
  const routes: { method: string; path: string }[] = [];
  for (const file of fs.readdirSync(path.join(srcDir, 'routes'))) {
    const src = read(`routes/${file}`);
    const factory = /export function (\w+Router)/.exec(src)?.[1];
    const prefix = factory ? mounts[factory] : undefined;
    expect(prefix, `routes/${file} is mounted in app.ts`).toBeDefined();
    for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']*)'/g))
      routes.push({
        method: m[1]!,
        path: (prefix! + (m[2] === '/' ? '' : m[2]!)).replace(/\/$/, ''),
      });
  }
  return routes;
}

/** The only routes an anonymous caller may use: the health check and the three session entry points. */
const PUBLIC = new Set([
  'get /api/health',
  'post /api/auth/register',
  'post /api/auth/login',
  'post /api/auth/logout',
]);
const UUID = '00000000-0000-4000-8000-000000000001';
const concrete = (p: string) => p.replace(/:id/g, UUID);

const routes = inventory();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('the route inventory', () => {
  it('finds the API (a sanity floor, so an empty scan can never pass)', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('every route that is not public refuses an anonymous caller with 401', async () => {
    const app = buildApp();
    const protectedRoutes = routes.filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));
    expect(protectedRoutes.length).toBeGreaterThan(40);
    for (const r of protectedRoutes) {
      const call = (request(app) as unknown as Record<string, (p: string) => request.Test>)[
        r.method
      ]!(concrete(r.path));
      const res = await (r.method === 'get' ? call : call.set('Origin', ORIGIN).send({}));
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
    }
  });

  it('every route with an id is in the ownership matrix (a foreign id answers like a missing one)', () => {
    const matrix = read('security/ownership.security.test.ts');
    const missing = routes
      .filter((r) => r.path.includes(':id'))
      .map((r) => `${r.method.toUpperCase()} ${r.path.replace('/api', '')}`)
      .filter((label) => !matrix.includes(`'${label}'`) && !matrix.includes(`'${label} `));
    expect(missing).toEqual([]);
  });

  it('every route answers no-store, whoever calls it and whatever it answers', async () => {
    const app = buildApp();
    const { agent } = await signUp(app, 'cache@example.com');
    for (const r of routes) {
      if (r.path === '/api/auth/logout') continue; // would end the session used for the next routes
      const call = (agent as unknown as Record<string, (p: string) => request.Test>)[r.method]!(
        concrete(r.path),
      );
      const res = await (r.method === 'get' ? call : call.send({}));
      expect(res.headers['cache-control'], `${r.method.toUpperCase()} ${r.path}`).toBe('no-store');
    }
  });
});
