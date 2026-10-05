import path from 'node:path';
import express, { Router, type RequestHandler } from 'express';

/**
 * Serves the built web app (production: one origin for the page and the API, no CORS needed).
 *  - Only files INSIDE the build folder, never directory listings, never dotfiles (`.env`, `.git`…).
 *  - Hashed files under /assets are cached for a year; the shell, the service worker and the manifest are
 *    always revalidated so an update is noticed.
 *  - Unknown paths WITHOUT a file extension get the app shell (client-side routes); a missing file or anything
 *    under /api is a real 404 and never turns into `index.html` with 200.
 */
export function staticWeb(distDir: string): Router {
  const root = path.resolve(distDir);
  const router = Router();

  router.use(
    express.static(root, {
      index: false,
      dotfiles: 'ignore',
      redirect: false,
      setHeaders(res, file) {
        const immutable = file.includes(`${path.sep}assets${path.sep}`);
        res.setHeader(
          'Cache-Control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );

  const spaFallback: RequestHandler = (req, res, next) => {
    const isPage = (req.method === 'GET' || req.method === 'HEAD') && path.extname(req.path) === '';
    if (!isPage || req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root, dotfiles: 'deny' }, (err) => err && next());
  };
  router.use(spaFallback);
  return router;
}
