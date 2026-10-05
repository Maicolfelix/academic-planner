import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
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

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}
