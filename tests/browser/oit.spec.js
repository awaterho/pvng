import { test, expect } from '@playwright/test';

// Builds a scene with two overlapping, differently-colored translucent
// spheres at different depths, in the given draw order. Used both to check
// the defining property of order-independent transparency (the final image
// must not depend on which order objects were added in) and as a screenshot
// baseline for the weighted-blended-OIT pipeline in general (viewer.ts's
// _draw()/_drawTransparent()/_compositeToCanvas(), gfx/oit-buffers.ts,
// shaders.ts's OIT_ACCUM_*/OIT_COMPOSITE_* shaders).
async function renderOverlappingSpheres(page, order) {
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async (order) => {
    const pv = await import('/src/viewer.ts');
    const viewer = pv.default.Viewer(document.getElementById('viewer'), {
      width: 200, height: 200, background: '#000', outline: false, fog: false,
    });
    window.__viewer = viewer;
    const addRed = () => {
      viewer.customMesh('red').addSphere([0, 0, 5], 8, { color: [1, 0, 0, 0.5] });
    };
    const addBlue = () => {
      viewer.customMesh('blue').addSphere([3, 0, -5], 8, { color: [0, 0, 1, 0.5] });
    };
    if (order === 'red-then-blue') {
      addRed();
      addBlue();
    } else {
      addBlue();
      addRed();
    }
    viewer.setZoom(40);
    viewer.setCenter([0, 0, 0]);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, order);
}

test('transparency compositing is order-independent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await renderOverlappingSpheres(page, 'red-then-blue');
  const pixelA = await page.evaluate(() => {
    const gl = window.__viewer.gl();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pixels = new Uint8Array(4);
    gl.readPixels(115, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  });

  await renderOverlappingSpheres(page, 'blue-then-red');
  const pixelB = await page.evaluate(() => {
    const gl = window.__viewer.gl();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pixels = new Uint8Array(4);
    gl.readPixels(115, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  });

  expect(errors).toEqual([]);
  // sanity check: this pixel must actually be inside the overlap region
  // (not plain background or a single sphere's flat color), otherwise the
  // order-independence check below would pass trivially.
  expect(pixelA).not.toEqual([0, 0, 0, 255]);
  expect(pixelA[0]).toBeGreaterThan(0);
  expect(pixelA[2]).toBeGreaterThan(0);
  expect(pixelA).toEqual(pixelB);
});

test('overlapping transparent spheres render matches the baseline', async ({ page }) => {
  await renderOverlappingSpheres(page, 'red-then-blue');
  await expect(page.locator('#viewer canvas').first()).toHaveScreenshot('oit-overlapping-spheres.png');
});
