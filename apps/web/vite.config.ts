/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` ports are project-specific so they don't collide with other local apps on
// 3000/5173: the API dev server listens on PORT (default 3300) and Vite on WEB_PORT (default
// 5300). strictPort makes Vite fail loudly instead of hopping to another port. The /api proxy
// targets API_PORT, else PORT, else 3300. (Production/Docker keep the server default of 3000.)
const apiPort = process.env.API_PORT ?? process.env.PORT ?? '3300';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5300),
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
