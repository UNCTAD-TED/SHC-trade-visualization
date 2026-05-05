import { defineConfig } from 'vite';

export default defineConfig({
  base: '/SHC-trade-visualization/',
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
