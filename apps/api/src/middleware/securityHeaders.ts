import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Response headers for every answer of the server (the API and, in production, the web app it serves).
 *
 * CSP: the app is a bundle of its own files (scripts, styles, worker, manifest), talks only to its own origin and
 * needs no frames, plugins or third parties. The only relaxations, each for a measured reason:
 *  - `style-src-attr 'unsafe-inline'`: React `style={…}` attributes (positions in the weekly grid, progress bars).
 *    Style ATTRIBUTES only: `<style>` elements and inline scripts stay blocked.
 *  - `img-src data:`: the favicon is an inline SVG data URI (a file would be one more request to refuse).
 * `script-src` has NO 'unsafe-inline' and NO 'unsafe-eval'. HSTS is only sent when the deployment is HTTPS.
 */
export function securityHeaders({ https }: { https: boolean }): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'style-src-attr': ["'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' },
      strictTransportSecurity: https ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
    // The app uses none of these browser features (a photo of the schedule goes through a plain file input).
    (_req, res, next) => {
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      );
      next();
    },
  ];
}

/** Everything under /api is private and depends on the session or on "now": never stored by a browser or proxy. */
export const noStoreApi: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};
