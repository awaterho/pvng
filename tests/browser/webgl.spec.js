import { test, expect } from '@playwright/test';

// Each fixture is a QUnit-style test file (ported mechanically from the old
// AMD/QUnit suite, see tests/browser/shim.js) that self-registers its
// test(name, fn) calls against the shim when imported. We import each
// fixture inside the page (so it runs against a real WebGL context), wait
// for any assert.async() work to finish, then report every QUnit test's
// pass/fail back here.
const FIXTURES = [
  { name: 'gfx/canvas', path: '/tests/browser/fixtures/canvas.fixture.js' },
  { name: 'gfx/base-geom', path: '/tests/browser/fixtures/base-geom.fixture.js' },
  { name: 'viewer/functional', path: '/tests/browser/fixtures/functional.fixture.js' },
  { name: 'viewer/pick', path: '/tests/browser/fixtures/pick.fixture.js' },
];

for (const fixture of FIXTURES) {
  test(fixture.name, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/tests/browser/harness.html');
    await page.evaluate(async (path) => {
      await import(path);
    }, fixture.path);

    await page.waitForFunction(
      async () => {
        const shim = await import('/tests/browser/shim.js');
        return shim.getPending() === 0;
      },
      null,
      { timeout: 20000 },
    );

    const results = await page.evaluate(async () => {
      const shim = await import('/tests/browser/shim.js');
      return shim.getResults();
    });

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.passed, `${r.name}: ${r.errors.join('; ')}`).toBe(true);
    }
  });
}
