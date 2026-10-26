import { z } from 'zod';

/** A TCP port written as plain digits (no sign, no decimals, no exponent, no spaces) in 1–65535. */
const portSchema = z
  .string()
  .regex(/^\d+$/, 'must be a whole number made of digits only')
  .transform(Number)
  .refine((n) => n >= 1 && n <= 65535, 'must be between 1 and 65535');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Which port the API listens on (see `resolvePort`): `API_PORT` first, then the `PORT` many platforms inject, then 3000.
  API_PORT: z.string().optional(),
  PORT: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    // Credentials are sent with these requests: a wildcard (or anything that is not an exact http(s) origin) is an
    // invalid configuration, not a permissive one.
    .refine(
      (origins) =>
        origins.length > 0 &&
        origins.every((o) => {
          try {
            const u = new URL(o);
            return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === o;
          } catch {
            return false;
          }
        }),
      'CORS_ORIGIN must be a comma-separated list of exact origins (e.g. https://app.example.com), never *',
    ),
  // Behind a reverse proxy the client IP (rate limits) comes from X-Forwarded-For. Say EXACTLY how many proxies
  // are in front (1, 2…) or which addresses ("loopback", "10.0.0.0/8"). Unset = no proxy. `true` is refused:
  // it would trust any client-supplied header and make every rate limit bypassable.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || (v.toLowerCase() !== 'true' && v.toLowerCase() !== '*'), {
      message: 'TRUST_PROXY=true trusts every client; use a hop count or a list of proxy addresses',
    })
    .transform((v) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : v)),
  // Folder with the built web app (apps/web/dist). When set, the API serves it (production: one origin).
  WEB_DIST_DIR: z.string().optional(),
  // Failed logins allowed per IP per 15 min (successful logins are not counted).
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Registrations allowed per IP per hour.
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  // Schedule imports (OCR is the costliest thing the API does) allowed per IP per 10 min.
  SCHEDULE_IMPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

type Parsed = z.infer<typeof envSchema>;
export type Env = Omit<Parsed, 'API_PORT' | 'PORT'> & { API_PORT: number };

const isSet = (v: string | undefined): v is string => v !== undefined;
const isBlank = (v: string | undefined) => v === undefined || v.trim() === '';

/**
 * `API_PORT` wins; without it the `PORT` that many platforms inject; without either, 3000. Only the port that is USED is
 * validated: a stray `PORT` is ignored while `API_PORT` is set. A value that is set but blank or malformed is an error,
 * never silently replaced by the next one.
 */
function resolvePort(source: NodeJS.ProcessEnv): { port: number } | { problem: string } {
  const [name, raw] = isSet(source.API_PORT)
    ? (['API_PORT', source.API_PORT] as const)
    : isSet(source.PORT)
      ? (['PORT', source.PORT] as const)
      : ([undefined, undefined] as const);
  if (name === undefined) return { port: 3000 };
  const parsed = portSchema.safeParse(raw);
  return parsed.success
    ? { port: parsed.data }
    : { problem: `${name}: ${parsed.error.issues[0]?.message ?? 'invalid port'}` };
}

/**
 * In production the operator must DECLARE the two things whose defaults are only right for development: the public origin
 * (the default is `http://localhost:5173`, so every browser write would be refused) and where the built web app is (without it
 * the API would answer `/` with a 404). `NODE_ENV` itself is never assumed: the operator sets it.
 */
function productionProblems(source: NodeJS.ProcessEnv): string[] {
  if (source.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (isBlank(source.CORS_ORIGIN))
    problems.push(
      'CORS_ORIGIN: required in production (the exact public origin, e.g. https://app.example.com)',
    );
  if (isBlank(source.WEB_DIST_DIR))
    problems.push('WEB_DIST_DIR: required in production (the folder with the built web app)');
  return problems;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const port = resolvePort(source);
  if ('problem' in port) problems.push(port.problem);
  problems.push(...productionProblems(source));
  if (!parsed.success || 'problem' in port || problems.length > 0) {
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  // `API_PORT`/`PORT` are raw strings in the schema; the resolved number is the only one the rest of the app sees.
  const { API_PORT: _raw, PORT: _fallback, ...rest } = parsed.data;
  void _raw;
  void _fallback;
  return { ...rest, API_PORT: port.port };
}
