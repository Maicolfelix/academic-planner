import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const DB = { DATABASE_URL: 'postgresql://x' };
const PROD = {
  ...DB,
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://planner.example.edu',
  WEB_DIST_DIR: '/app/apps/web/dist',
};

describe('loadEnv', () => {
  it('applies defaults and splits CORS origins', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x', CORS_ORIGIN: 'http://a, http://b' });
    expect(env.API_PORT).toBe(3000);
    expect(env.CORS_ORIGIN).toEqual(['http://a', 'http://b']);
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  describe('development and test keep their defaults', () => {
    for (const NODE_ENV of [undefined, 'development', 'test'] as const) {
      it(`${NODE_ENV ?? 'unset'}: no CORS_ORIGIN or WEB_DIST_DIR needed`, () => {
        const env = loadEnv({ ...DB, ...(NODE_ENV && { NODE_ENV }) });
        expect(env.NODE_ENV).toBe(NODE_ENV ?? 'development');
        expect(env.CORS_ORIGIN).toEqual(['http://localhost:5173']);
        expect(env.WEB_DIST_DIR).toBeUndefined();
      });
    }
  });

  describe('production declares what only development may default', () => {
    it('accepts a complete production configuration', () => {
      const env = loadEnv({ ...PROD, TRUST_PROXY: '1' });
      expect(env.NODE_ENV).toBe('production');
      expect(env.CORS_ORIGIN).toEqual(['https://planner.example.edu']);
      expect(env.WEB_DIST_DIR).toBe('/app/apps/web/dist');
      expect(env.TRUST_PROXY).toBe(1);
    });

    it('requires CORS_ORIGIN (the development default would refuse every browser write)', () => {
      const { CORS_ORIGIN: _omit, ...rest } = PROD;
      void _omit;
      expect(() => loadEnv(rest)).toThrow(/CORS_ORIGIN: required in production/);
      expect(() => loadEnv({ ...rest, CORS_ORIGIN: '   ' })).toThrow(/CORS_ORIGIN: required/);
    });

    it('requires WEB_DIST_DIR (without it the API would not serve the app)', () => {
      const { WEB_DIST_DIR: _omit, ...rest } = PROD;
      void _omit;
      expect(() => loadEnv(rest)).toThrow(/WEB_DIST_DIR: required in production/);
      expect(() => loadEnv({ ...rest, WEB_DIST_DIR: '' })).toThrow(/WEB_DIST_DIR: required/);
    });

    it('reports every missing variable at once and never prints a secret', () => {
      const secret = 'postgresql://app:s3cr3t-password@example/planner';
      let message = '';
      try {
        loadEnv({ DATABASE_URL: secret, NODE_ENV: 'production' });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/CORS_ORIGIN/);
      expect(message).toMatch(/WEB_DIST_DIR/);
      expect(message).not.toContain('s3cr3t-password');
    });

    it('still applies every existing rule: a wildcard origin and TRUST_PROXY=true are refused', () => {
      expect(() => loadEnv({ ...PROD, CORS_ORIGIN: '*' })).toThrow(/never \*/);
      expect(() => loadEnv({ ...PROD, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
      expect(() => loadEnv({ ...PROD, TRUST_PROXY: '*' })).toThrow(/TRUST_PROXY/);
    });

    it('NODE_ENV is never assumed: without it nothing is required, because it is not production', () => {
      const env = loadEnv({ ...DB, WEB_DIST_DIR: undefined });
      expect(env.NODE_ENV).toBe('development');
    });

    it('does not turn another NODE_ENV into production', () => {
      expect(() => loadEnv({ ...DB, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
      expect(() => loadEnv({ ...DB, NODE_ENV: 'Production' })).toThrow(/NODE_ENV/);
    });
  });

  describe('port: API_PORT, then PORT, then 3000', () => {
    it('API_PORT only', () => expect(loadEnv({ ...DB, API_PORT: '4100' }).API_PORT).toBe(4100));
    it('PORT only (what many platforms inject)', () =>
      expect(loadEnv({ ...DB, PORT: '8080' }).API_PORT).toBe(8080));
    it('both: API_PORT wins', () =>
      expect(loadEnv({ ...DB, API_PORT: '4100', PORT: '8080' }).API_PORT).toBe(4100));
    it('neither: 3000', () => expect(loadEnv({ ...DB }).API_PORT).toBe(3000));

    it('an invalid API_PORT is an error, not a silent fallback to PORT', () => {
      for (const bad of ['abc', '0', '-1', '3000.5', '1e3', '65536', '', ' 3000']) {
        expect(() => loadEnv({ ...DB, API_PORT: bad, PORT: '8080' }), bad).toThrow(/API_PORT/);
      }
    });

    it('an invalid PORT is an error when it is the one in use', () => {
      for (const bad of ['abc', '0', '-1', '8080.5', '99999', '']) {
        expect(() => loadEnv({ ...DB, PORT: bad }), bad).toThrow(/PORT: /);
      }
    });

    it('a stray PORT is ignored while API_PORT is set', () => {
      expect(loadEnv({ ...DB, API_PORT: '4100', PORT: 'not-a-port' }).API_PORT).toBe(4100);
    });

    it('the resolved value is a number and the raw PORT is not exposed', () => {
      const env = loadEnv({ ...DB, PORT: '8080' });
      expect(env.API_PORT).toBe(8080);
      expect('PORT' in env).toBe(false);
    });
  });
});
