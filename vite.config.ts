import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/pv.js'),
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
});
