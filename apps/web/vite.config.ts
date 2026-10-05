import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Single source of truth: the root .env (also used by the API).
  const env = loadEnv(mode, '../../', '');
  const port = Number(env.WEB_PORT ?? 5173);
  const proxy = { '/api': { target: env.API_PROXY_TARGET ?? 'http://localhost:3000' } };
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // The student decides when to update (never a silent reload that could lose a form).
        registerType: 'prompt',
        injectRegister: false, // registered by `useRegisterSW` in PwaNotices
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'Academic Planner',
          short_name: 'Planner',
          description: 'Planificador académico: asignaturas, actividades, agenda y progreso.',
          lang: 'es',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#0f172a',
          background_color: '#ffffff',
          categories: ['education', 'productivity'],
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Only the static, hashed app shell is precached. Old precaches are removed on activation.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          cleanupOutdatedCaches: true,
          // Deep links (/dashboard, /inbox…) get the shell; the API never does.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          // Private data is never stored: every API request (auth included, any method) goes to the network.
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
            },
          ],
        },
        // No service worker under `npm run dev`: no stale caches while developing.
        devOptions: { enabled: false },
      }),
    ],
    server: { port, strictPort: true, proxy },
    // `vite preview` serves the built bundle (used by the e2e stack) with the same /api proxy.
    preview: { port, strictPort: true, proxy },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  };
});
