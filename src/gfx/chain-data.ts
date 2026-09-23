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
import VertexArray from './vertex-array';
import IndexedVertexArray from './indexed-vertex-array';
import type Cam from './cam';
import type { ShaderProgram } from './cam';

export interface Shader extends ShaderProgram {
  symId: WebGLUniformLocation;
  posAttrib: number;
  endAttrib: number;
  mappingAttrib: number;
  colorAttrib: number;
  objIdAttrib: number;
  selectAttrib: number;
}

// LineChainData and MeshChainData are two internal classes that add molecule-
// specific attributes and functionality to the IndexedVertexArray and
// VertexArray classes.
//
// NOTE: kept as prototype-based constructor functions, not real ES classes
// -- see gfx/vertex-array-base.ts for why (they chain-invoke
// VertexArray/IndexedVertexArray via `.call(this, ...)`, which requires
// those to stay callable without `new`, which in turn requires their own
// callers to follow the same pattern up the chain).
interface LineChainData extends InstanceType<typeof VertexArray> {
  _chain: unknown;
  chain(): unknown;
  drawSymmetryRelated(cam: Cam, shader: Shader, transforms: mat4[]): void;
}

interface LineChainDataConstructor {
  new (chain: unknown, gl: WebGL2RenderingContext, numVerts: number, float32Allocator: unknown): LineChainData;
  (
    this: LineChainData, chain: unknown, gl: WebGL2RenderingContext, numVerts: number,
    float32Allocator: unknown,
  ): void;
  prototype: LineChainData;
}

const LineChainData = function(
  this: LineChainData, chain: unknown, gl: WebGL2RenderingContext, numVerts: number,
  float32Allocator: unknown,
) {
  (VertexArray as unknown as (
    this: LineChainData, gl: WebGL2RenderingContext, numVerts: number, float32Allocator: unknown
  ) => void).call(this, gl, numVerts, float32Allocator);
  this._chain = chain;
} as unknown as LineChainDataConstructor;

utils.derive(LineChainData, VertexArray, {
  chain: function(this: LineChainData) { return this._chain; },

  drawSymmetryRelated: function(this: LineChainData, cam: Cam, shader: Shader, transforms: mat4[]): void {
    this.bind(shader);
    for (let i = 0; i < transforms.length; ++i) {
      cam.bind(shader, transforms[i]);
      this._gl.uniform1i(shader.symId, i);
      this.draw();
    }
    this.releaseAttribs(shader);
  }
} as Partial<LineChainData>);

interface MeshChainData extends InstanceType<typeof IndexedVertexArray> {
  _chain: unknown;
  chain(): unknown;
  drawSymmetryRelated(cam: Cam, shader: Shader, transforms: mat4[]): void;
}

interface MeshChainDataConstructor {
  new (
    chain: unknown, gl: WebGL2RenderingContext, numVerts: number, numIndices: number,
    float32Allocator: unknown, uint16Allocator: unknown,
  ): MeshChainData;
  (
    this: MeshChainData, chain: unknown, gl: WebGL2RenderingContext, numVerts: number, numIndices: number,
    float32Allocator: unknown, uint16Allocator: unknown,
  ): void;
  prototype: MeshChainData;
}

const MeshChainData = function(
  this: MeshChainData, chain: unknown, gl: WebGL2RenderingContext, numVerts: number, numIndices: number,
  float32Allocator: unknown, uint16Allocator: unknown,
) {
  (IndexedVertexArray as unknown as (
    this: MeshChainData, gl: WebGL2RenderingContext, numVerts: number, numIndices: number,
    float32Allocator: unknown, uint16Allocator: unknown,
  ) => void).call(this, gl, numVerts, numIndices, float32Allocator, uint16Allocator);
  this._chain = chain;
} as unknown as MeshChainDataConstructor;

utils.derive(MeshChainData, IndexedVertexArray, {
  chain: function(this: MeshChainData) { return this._chain; }
} as Partial<MeshChainData>);

MeshChainData.prototype.drawSymmetryRelated =
  LineChainData.prototype.drawSymmetryRelated;


export default {
  LineChainData : LineChainData,
  MeshChainData : MeshChainData
};
