import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { external: ['node:module'] },
  },
});
