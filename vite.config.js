import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.VERSION_NAME || 'dev') },
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
