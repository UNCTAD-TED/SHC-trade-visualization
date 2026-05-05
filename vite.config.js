import { defineConfig } from 'vite';

export default defineConfig({
  base: '/SHC-tradeMap-UNCTADstyled/',
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
