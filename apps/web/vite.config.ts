import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Single source of truth: the root .env (also used by the API).
  const env = loadEnv(mode, '../../', '');
  const port = Number(env.WEB_PORT ?? 5173);
  const proxy = { '/api': { target: env.API_PROXY_TARGET ?? 'http://localhost:3000' } };
  return {
    plugins: [react(), tailwindcss()],
    server: { port, strictPort: true, proxy },
    // `vite preview` serves the built bundle (used by the e2e stack) with the same /api proxy.
    preview: { port, strictPort: true, proxy },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  };
});
