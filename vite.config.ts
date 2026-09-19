import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => ({
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
    minify: mode === 'debug' ? false : true,
    outDir: mode === 'debug' ? 'dist-debug' : 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.js'],
    setupFiles: ['./src/tests/xhr-node-shim.js'],
  },
}));
