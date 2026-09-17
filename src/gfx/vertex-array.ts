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
import VertexArrayBase from './vertex-array-base';

interface Shader extends WebGLProgram {
  posAttrib: number;
  colorAttrib: number;
  objIdAttrib: number;
  selectAttrib: number;
}

// NOTE: kept as a prototype-based constructor function, not a real ES class
// -- see gfx/vertex-array-base.ts for why (gfx/chain-data.js, not yet
// converted, chain-invokes this via `VertexArray.call(this, ...)`).
//
// (unindexed) vertex array for line-based geometries
interface VertexArray extends VertexArrayBase {
  _numVerts: number;
  _primitiveType: number;
  _POS_OFFSET: number;
  _ID_OFFSET: number;

  setDrawAsPoints(enable: boolean): void;
  addPoint(pos: ArrayLike<number>, color: ArrayLike<number>, id: number): void;
  addLine(
    startPos: ArrayLike<number>, startColor: ArrayLike<number>,
    endPos: ArrayLike<number>, endColor: ArrayLike<number>,
    idOne: number, idTwo: number,
  ): void;
  bindAttribs(shader: Shader): void;
  releaseAttribs(shader: Shader): void;
  bind(shader: Shader): void;
  draw(): void;
}

interface VertexArrayConstructor {
  new (gl: WebGLRenderingContext, numVerts: number, float32Allocator: unknown): VertexArray;
  (this: VertexArray, gl: WebGLRenderingContext, numVerts: number, float32Allocator: unknown): void;
  prototype: VertexArray;
}

const VertexArray = function(
  this: VertexArray, gl: WebGLRenderingContext, numVerts: number, float32Allocator: unknown,
) {
  (VertexArrayBase as unknown as (
    this: VertexArray, gl: WebGLRenderingContext, numVerts: number, float32Allocator: unknown
  ) => void).call(this, gl, numVerts, float32Allocator);
  this._numVerts = 0;
  this._primitiveType = this._gl.LINES;
} as unknown as VertexArrayConstructor;

utils.derive(VertexArray, VertexArrayBase, {

  _FLOATS_PER_VERT : 9,
  _POS_OFFSET : 0,
  _COLOR_OFFSET : 3,
  _ID_OFFSET : 7,
  _SELECT_OFFSET : 8,

  numVerts: function(this: VertexArray) { return this._numVerts; },

  setDrawAsPoints: function(this: VertexArray, enable: boolean): void {
    if (enable) {
      this._primitiveType = this._gl.POINTS;
    } else {
      this._primitiveType = this._gl.LINES;
    }
  },

  addPoint: function(this: VertexArray, pos: ArrayLike<number>, color: ArrayLike<number>, id: number): void {
    let index = this._FLOATS_PER_VERT * this._numVerts;
    this._vertData[index++] = pos[0]!;
    this._vertData[index++] = pos[1]!;
    this._vertData[index++] = pos[2]!;
    this._vertData[index++] = color[0]!;
    this._vertData[index++] = color[1]!;
    this._vertData[index++] = color[2]!;
    this._vertData[index++] = color[3]!;
    this._vertData[index++] = id;
    this._vertData[index++] = 0.0;
    this._numVerts += 1;
    this._ready = false;
    this._boundingSphere = null;
  },

  addLine: function(
    this: VertexArray, startPos: ArrayLike<number>, startColor: ArrayLike<number>,
    endPos: ArrayLike<number>, endColor: ArrayLike<number>, idOne: number, idTwo: number,
  ): void {
    this.addPoint(startPos, startColor, idOne);
    this.addPoint(endPos, endColor, idTwo);
  },


  bindAttribs: function(this: VertexArray, shader: Shader): void {
    this._gl.vertexAttribPointer(shader.posAttrib, 3, this._gl.FLOAT, false,
                                  this._FLOATS_PER_VERT * 4,
                                  this._POS_OFFSET * 4);
    if (shader.colorAttrib !== -1) {
      this._gl.vertexAttribPointer(shader.colorAttrib, 4, this._gl.FLOAT, false,
                                  this._FLOATS_PER_VERT * 4,
                                  this._COLOR_OFFSET * 4);
      this._gl.enableVertexAttribArray(shader.colorAttrib);
    }
    this._gl.enableVertexAttribArray(shader.posAttrib);
    if (shader.objIdAttrib !== -1) {
      this._gl.vertexAttribPointer(shader.objIdAttrib, 1, this._gl.FLOAT, false,
                                   this._FLOATS_PER_VERT * 4,
                                   this._ID_OFFSET * 4);
      this._gl.enableVertexAttribArray(shader.objIdAttrib);
    }
    if (shader.selectAttrib !== -1) {
      this._gl.vertexAttribPointer(shader.selectAttrib, 1, this._gl.FLOAT,
                                   false, this._FLOATS_PER_VERT * 4,
                                   this._SELECT_OFFSET * 4);
      this._gl.enableVertexAttribArray(shader.selectAttrib);
    }
  },

  releaseAttribs: function(this: VertexArray, shader: Shader): void {
    this._gl.disableVertexAttribArray(shader.posAttrib);
    if (shader.colorAttrib !== -1) {
      this._gl.disableVertexAttribArray(shader.colorAttrib); }
    if (shader.objIdAttrib !== -1) {
      this._gl.disableVertexAttribArray(shader.objIdAttrib);
    }
    if (shader.selectAttrib !== -1) {
      this._gl.disableVertexAttribArray(shader.selectAttrib);
    }
  },

  bind: function(this: VertexArray, shader: Shader): void {
    this.bindBuffers();
    this.bindAttribs(shader);
  },

  // draws all triangles contained in the indexed vertex array using the
  // provided shader.
  draw: function(this: VertexArray): void {
    this._gl.drawArrays(this._primitiveType, 0, this._numVerts);
  }
} as Partial<VertexArray>);

export default VertexArray;
