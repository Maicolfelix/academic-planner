import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Single source of truth: the root .env (also used by the API).
  const env = loadEnv(mode, '../../', '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: { '/api': { target: env.API_PROXY_TARGET ?? 'http://localhost:3000' } },
    },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  };
});
