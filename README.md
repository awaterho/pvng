pvng - WebGL2 protein viewer
=========================================

`pvng` is a WebGL2-based protein viewer for the browser. It renders cartoons, ball-and-stick,
line, trace, sphere and point representations directly from PDB or mmCIF files, with custom
color schemes, selections, and proper order-independent transparency, all at interactive
framerates even for large macromolecules.

Origins
-----------------------------------------

`pvng` is a fork and continuation of [`pv`](https://github.com/biasmv/pv), the WebGL protein
viewer originally created by [Marco Biasini](https://github.com/biasmv). The original project
was archived as no longer maintained; `pvng` builds on that foundation and carries the work
forward: the rendering engine, molecule model and file parsers are all still fundamentally
Marco's design. Huge thanks to him, and to everyone who contributed to the original `pv`
(`@Traksewt`, `@kozmad`, `@greenify`, `@andreasprlic`, and others credited in `pv`'s own
history).

Since forking, the project has been substantially modernized:

  - migrated the WebGL context from WebGL1 to WebGL2
  - full rewrite of the codebase from JavaScript to TypeScript
  - replaced the AMD/RequireJS/Grunt build with [Vite](https://vitejs.dev), publishing ESM, CJS
    and IIFE bundles with generated type declarations
  - replaced the vendored `gl-matrix` copy with the upstream npm package
  - replaced screen-door transparency with proper weighted blended order-independent
    transparency (OIT), including for billboarded spheres
  - added an mmCIF/CIF parser alongside the existing PDB parser
  - migrated the test suite from QUnit to [Vitest](https://vitest.dev) (unit) and
    [Playwright](https://playwright.dev) (browser/visual regression)

Trying it out
-----------------------------------------

Clone this repository:

```bash
git clone https://github.com/awaterho/pvng.git
cd pvng
npm install
```

Then start the Vite dev server:

```bash
npm run dev
```

This opens `dev.html`, which loads the viewer directly from TypeScript source. `demo.html`
exercises the built `dist/` bundle instead and is a closer approximation of how a consuming
website would use the library.

Using pvng on your website
----------------------------------------

`pvng` isn't published to npm yet (`bio-pv` on the registry is still the original, unmaintained
`pv` package, not this fork). In the meantime, build it yourself and copy the bundle into your
site:

```bash
git clone https://github.com/awaterho/pvng.git
cd pvng
npm install
npm run build
```

This produces `dist/pv.iife.js`, which defines a global `pv` and can be dropped straight into a
page with a plain `<script>` tag (`dist/pv.js` and `dist/pv.cjs` are also available if you're
using a bundler or `require`):

```
<div id="viewer" style="width: 100%; height: 100%;"></div>
<script src="pv.iife.js"></script>
<script>
  var viewer = pv.Viewer(document.getElementById('viewer'), {
    width: 'auto',
    height: 'auto',
    antialias: true,
    quality: 'high',
  });

  pv.io.fetchCif('https://files.rcsb.org/download/1HBB.cif', function (structure) {
    viewer.cartoon('protein', structure, { color: pv.color.ssSuccession() });
    viewer.autoZoom();
  });
</script>
```

WebGL2 is required, so pvng won't run in browsers without WebGL2 support.

Development
----------------------------------------

```bash
npm run dev         # start the Vite dev server (dev.html)
npm run build        # produce dist/pv.{js,cjs,iife.js} + type declarations
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # unit tests (vitest)
npm run test:browser # browser/visual-regression tests (playwright)
```
