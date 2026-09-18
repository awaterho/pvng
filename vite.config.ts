import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

// Vite's dev server only special-cases index.html for the "/" route.
// Rewrite it to dev.html so `npm run dev` opens that page instead.
function devHtmlEntry(): Plugin {
  return {
    name: 'dev-html-entry',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/') req.url = '/dev.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devHtmlEntry()],
  server: {
    open: '/dev.html',
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'pv',
      formats: ['es', 'cjs', 'iife'],
      fileName: (format) => {
        if (format === 'es') return 'pv.js';
        if (format === 'cjs') return 'pv.cjs';
        return 'pv.iife.js';
      },
    },
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.js'],
    setupFiles: ['./src/tests/xhr-node-shim.js'],
  },
});
