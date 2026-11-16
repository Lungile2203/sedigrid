import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website lives in site/ and is served at /. The dashboard builds into site/app/ and is served at /app/.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  publicDir: false,
  build: { outDir: 'site/app', emptyOutDir: true },
});
