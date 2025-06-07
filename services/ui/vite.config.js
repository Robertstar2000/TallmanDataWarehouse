import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  // Serve assets from root for correct SPA routing
  base: '/',
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    open: true,
    hmr: { overlay: false },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  preview: {
    port: 4173,
  },
});
