import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  fullyParallel: true,
  webServer: {
    command: 'npx vite --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
  expect: {
    // screenshot baselines are compared across GPU/driver combinations that
    // can render the exact same scene with slightly different antialiasing/
    // rounding; a small tolerance avoids flaking on that noise while still
    // catching real regressions (wrong colors, missing geometry, broken
    // blending).
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
});
