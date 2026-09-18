// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import utils from '../utils';
import MeshGeom, { type MeshGeom as IMeshGeom } from './mesh-geom';
import type Cam from './cam';

interface ShaderCatalog {
  spheres: unknown;
  selectSpheres: unknown;
  spheresTransparent?: unknown;
  [pass: string]: unknown;
}

// NOTE: kept as a prototype-based constructor function -- see
// gfx/vertex-array-base.ts/gfx/base-geom.ts for why (this chain-invokes
// MeshGeom via `.call()`).
export type BillboardGeom = IMeshGeom;

interface BillboardGeomConstructor {
  new (gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: unknown): BillboardGeom;
  (
    this: BillboardGeom, gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: unknown,
  ): void;
  prototype: BillboardGeom;
}

const BillboardGeom = function(
  this: BillboardGeom, gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: unknown,
) {
  (MeshGeom as unknown as (
    this: BillboardGeom, gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: unknown
  ) => void).call(this, gl, float32Allocator, uint16Allocator);
} as unknown as BillboardGeomConstructor;

utils.derive(BillboardGeom, MeshGeom, {
  draw: function(this: BillboardGeom, cam: Cam, shaderCatalog: unknown, style: unknown, pass: unknown) {
    // we need the back-faces for the outline rendering
    this._gl.disable(this._gl.CULL_FACE);
    (MeshGeom.prototype.draw as (
      this: BillboardGeom, cam: Cam, shaderCatalog: unknown, style: unknown, pass: unknown
    ) => void).call(this, cam, shaderCatalog, style, pass);
    this._gl.enable(this._gl.CULL_FACE);
  },
  shaderForStyleAndPass: function(this: BillboardGeom, shaderCatalog: ShaderCatalog, style: unknown, pass: unknown) {
    // the normal pass contains render code for both the normal
    // and outline pass which is toggled on/off by a boolean
    // uniform.
    if (pass === 'normal') {
      return shaderCatalog.spheres;
    }
    if (pass === 'transparent') {
      return shaderCatalog.spheresTransparent ?? null;
    }
    if (pass === 'select') {
      return shaderCatalog.selectSpheres;
    }
    return null;
  },
} as Partial<BillboardGeom>);

export default BillboardGeom;
