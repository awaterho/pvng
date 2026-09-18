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
import type { mat4 } from 'gl-matrix';
import utils from '../utils';
import BaseGeom, { type BaseGeom as IBaseGeom } from './base-geom';
import chainData, { type Shader as ChainDataShader } from './chain-data';
import type Cam from './cam';

const LineChainData = chainData.LineChainData;
type LineChainData = InstanceType<typeof LineChainData>;

interface Shader extends ChainDataShader {
  pointSize: WebGLUniformLocation | null;
}

interface ShaderCatalog {
  selectLines: Shader;
  select: Shader;
  lines: Shader;
  linesTransparent?: Shader;
}

interface LGChain {
  name(): string;
}

// Holds geometrical data for objects rendered as lines. For each vertex,
// the color and position is stored in an interleaved format.
//
// NOTE: kept as a prototype-based constructor function -- see
// gfx/vertex-array-base.ts/gfx/base-geom.ts for why (this chain-invokes
// BaseGeom via `.call()`).
export interface LineGeom extends IBaseGeom {
  _vertArrays: LineChainData[];
  _float32Allocator: unknown;
  _lineWidth: number;
  _pointSize: number;
  _va?: unknown;

  addChainVertArray(chain: LGChain, numVerts: number): LineChainData;
  setLineWidth(width: number): void;
  setPointSize(size: number): void;
  vertArray(): unknown;
}

interface LineGeomConstructor {
  new (gl: WebGL2RenderingContext, float32Allocator: unknown): LineGeom;
  (this: LineGeom, gl: WebGL2RenderingContext, float32Allocator: unknown): void;
  prototype: LineGeom;
}

const LineGeom = function(this: LineGeom, gl: WebGL2RenderingContext, float32Allocator: unknown) {
  (BaseGeom as unknown as (this: LineGeom, gl: WebGL2RenderingContext) => void).call(this, gl);
  this._vertArrays = [];
  this._float32Allocator = float32Allocator;
  this._lineWidth = 0.5;
  this._pointSize = 1.0;
} as unknown as LineGeomConstructor;

utils.derive(LineGeom, BaseGeom, {
  addChainVertArray: function(this: LineGeom, chain: LGChain, numVerts: number) {
    const va = new LineChainData(chain.name(), this._gl, numVerts,
                              this._float32Allocator);
    this._vertArrays.push(va);
    return va;
  },


  setLineWidth: function(this: LineGeom, width: number) {
    this._lineWidth = width;
  },
  setPointSize: function(this: LineGeom, size: number) {
    this._pointSize = size;
  },

  vertArrays: function(this: LineGeom) {
    return this._vertArrays;
  },

  shaderForStyleAndPass: function(
    this: LineGeom, shaderCatalog: ShaderCatalog, style: unknown, pass: unknown
  ) {
    if (pass === 'outline') {
      return shaderCatalog.selectLines;
    }
    if (pass === 'select') {
      return shaderCatalog.select;
    }
    if (pass === 'transparent') {
      return shaderCatalog.linesTransparent ?? null;
    }
    return shaderCatalog.lines;
  },

  destroy: function(this: LineGeom) {
    (BaseGeom.prototype.destroy as (this: LineGeom) => void).call(this);
    for (let i = 0; i < this._vertArrays.length; ++i) {
      this._vertArrays[i]!.destroy();
    }
    this._vertArrays = [];
  },

  _drawVertArrays: function(
    this: LineGeom, cam: Cam, shader: Shader, vertArrays: LineChainData[],
    additionalTransforms: mat4[] | null,
  ) {
    let pointSizeMul = cam.upsamplingFactor();
    if (shader.selectAttrib !== -1) {
      pointSizeMul = 4.0 * cam.upsamplingFactor();
    }
    let i;
    if (additionalTransforms) {
      cam.bind(shader);
      this._gl.lineWidth(pointSizeMul * this._lineWidth);
      if (shader.pointSize) {
        this._gl.uniform1f(shader.pointSize,
                          pointSizeMul * this._pointSize);
      }
      for (i = 0; i < vertArrays.length; ++i) {
        vertArrays[i]!.drawSymmetryRelated(cam, shader, additionalTransforms);
      }
    } else {
      cam.bind(shader);
      this._gl.lineWidth(pointSizeMul * this._lineWidth);
      this._gl.uniform1i(shader.symId, 255);
      if (shader.pointSize) {
        this._gl.uniform1f(shader.pointSize,
                          pointSizeMul * this._pointSize);
      }
      for (i = 0; i < vertArrays.length; ++i) {
        vertArrays[i]!.bind(shader);
        vertArrays[i]!.draw();
        vertArrays[i]!.releaseAttribs(shader);
      }
    }
  },

  vertArray: function(this: LineGeom) { return this._va; }
} as Partial<LineGeom>);

export default LineGeom;
