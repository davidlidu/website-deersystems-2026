import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// En desarrollo: `npm run dev` (API en :3000) y `npm run dev:web` (Vite en :5173, que reenvía /api y /auth).
// Con PARTNERS_URL=http://localhost:5173 en .env, el servidor reconoce las peticiones reenviadas como de partners.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../public/partners', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/auth': { target: 'http://localhost:3000', changeOrigin: false },
      '/favicon.svg': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
