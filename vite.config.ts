import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A relative base keeps the same build usable at a domain root and below
// GitHub Pages' /<repository>/ path. It also keeps the manifest and SW URLs
// valid when the repository is renamed.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
